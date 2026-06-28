// OSIRIS sales assistant — proxies chat messages to the Anthropic Messages API
// with an OSIRIS-specific system prompt. Requires ANTHROPIC_API_KEY to be set
// as a function secret. Without it, returns 503 so the UI degrades gracefully.
//
// Supports two modes:
//   POST /              -> non-streaming, returns { reply: "..." }
//   POST /?stream=1     -> Server-Sent Events stream of text deltas; the body
//                          is forwarded straight from the Anthropic SSE response.
//                          The client should read events of type
//                          "content_block_delta" and concat their text fields.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

// Read the Anthropic key from the locked integration_secrets table, falling
// back to a function secret if present.
async function getAnthropicKey(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "ANTHROPIC_API_KEY")
    .single();
  return data?.value ?? Deno.env.get("ANTHROPIC_API_KEY") ?? null;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are the Robin Line Assistant, an AI sales coach for SDRs at Robin Line.
Robin Line is the AI operating system for cleaning companies (it answers leads, quotes, dispatches, collects payment, wins back customers). The SDR's one job is to book qualified demo calls with house/commercial cleaning-company owners — target 8 qualified shows/week.
You help reps:
- Work leads warmest-to-coldest (fresh ad leads/DMs -> follow-ups -> lists -> cold calls)
- Qualify fast (owner? cleaning co? has/wants lead flow? can afford $599+? real admin pain?)
- Handle objections (price -> "less than a VA, better than a VA"; "I already have a system"; trust -> built by an operator who runs a cleaning company)
- Write outreach (TikTok/IG/FB DMs, SMS, email, cold-call openers)
- Move deals: lead -> contacted -> demo booked -> demo done -> proposal -> won

Be concrete and brief. Default to bullet points. When asked for an outreach message, give a draft they can send in under a minute. When they describe a deal, suggest the single highest-leverage next action. Pricing: Starter $599, Growth $1,299, Scale $2,499/mo — reps book the demo, they don't negotiate price. Never invent Robin Line policies you don't know — if unsure, say so.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

type RequestBody = {
  messages: ChatMessage[];
};

const sanitize = (messages: unknown): ChatMessage[] | null => {
  if (!Array.isArray(messages)) return null;
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (
      m &&
      typeof m === "object" &&
      (m as { role?: unknown }).role !== undefined &&
      typeof (m as { content?: unknown }).content === "string"
    ) {
      const role = (m as { role: string }).role;
      if (role !== "user" && role !== "assistant") return null;
      const content = (m as { content: string }).content.slice(0, 4000);
      if (content.length === 0) continue;
      out.push({ role, content });
    } else {
      return null;
    }
  }
  if (out.length === 0) return null;
  // Cap at the last 20 messages to keep request size bounded.
  return out.slice(-20);
};

const handleChat = async (req: Request) => {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return createErrorResponse(
      503,
      "Robin Line assistant is not configured (ANTHROPIC_API_KEY missing).",
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }
  const messages = sanitize(body?.messages);
  if (!messages) {
    return createErrorResponse(400, "messages required");
  }

  const url = new URL(req.url);
  const wantStream = url.searchParams.get("stream") === "1";

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        stream: wantStream,
      }),
    });
  } catch (err) {
    console.error("Anthropic fetch failed", err);
    return createErrorResponse(502, "Assistant upstream failed");
  }

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => "");
    console.error(`Anthropic ${upstream.status}: ${errBody}`);
    return createErrorResponse(502, "Assistant upstream error");
  }

  if (wantStream && upstream.body) {
    // Forward the SSE stream straight to the client.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...corsHeaders,
      },
    });
  }

  const data = await upstream.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((c: { type?: string }) => c?.type === "text")
        .map((c: { text: string }) => c.text)
        .join("")
    : "";

  return new Response(JSON.stringify({ reply: text }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, () => handleChat(req)),
    ),
  ),
);

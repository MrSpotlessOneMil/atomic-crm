// OSIRIS sales assistant — proxies chat messages to the Anthropic Messages API
// with an OSIRIS-specific system prompt. Requires ANTHROPIC_API_KEY to be set
// as a function secret. Without it, returns 503 so the UI degrades gracefully.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are OSIRIS, an AI sales coach for a residential and commercial cleaning company called Spotless Scrubbers.
You help newly-onboarded sales reps:
- Find leads (residential, commercial, recurring contracts)
- Qualify prospects fast
- Handle objections (price, scheduling, trust, "I already have a cleaner")
- Write outreach messages (SMS, email, voicemail scripts)
- Move deals through the pipeline: discovery -> proposal -> in negotiation -> won

Be concrete and brief. Default to bullet points over prose. When the user asks for an outreach message, give them a draft they can send in under a minute. When they describe a deal, suggest the single highest-leverage next action. If they ask about commission/payouts, tell them to check the /payouts page in the app. Never make up Spotless Scrubbers policies you don't know - if you don't know, say so.`;

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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return createErrorResponse(
      503,
      "OSIRIS assistant is not configured (ANTHROPIC_API_KEY missing).",
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

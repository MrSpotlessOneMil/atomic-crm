import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

async function getAnthropicKey(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "ANTHROPIC_API_KEY")
    .single();
  return data?.value ?? Deno.env.get("ANTHROPIC_API_KEY") ?? null;
}

const SYSTEM = `You extract CRM lead info from pasted text (a profile, a message thread, a website blurb, a business listing — anything). The lead is a cleaning company or its owner.
Return ONLY a JSON object, no prose, with these keys (use "" when unknown):
{"company_name":"","first_name":"","last_name":"","email":"","phone":"","title":"","notes":""}
- company_name: the cleaning business name.
- first_name/last_name: the person (owner/contact). If only a full name, split it.
- notes: a 1-2 sentence summary of anything useful (what they do, pain points, context).
Be accurate; do not invent emails or phone numbers that aren't present.`;

async function extract(req: Request) {
  const { text } = await req.json();
  if (!text || typeof text !== "string") {
    return createErrorResponse(400, "Paste some text first.");
  }
  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return createErrorResponse(503, "AI is not configured.");
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 8000) }],
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("Anthropic error", body);
    return createErrorResponse(502, "AI request failed.");
  }
  const raw = body?.content?.[0]?.text ?? "{}";
  let parsed: Record<string, string>;
  try {
    // Pull the first {...} block in case the model adds stray text.
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    parsed = {};
  }
  return new Response(JSON.stringify({ data: parsed }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) =>
      UserMiddleware(req, async (req) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        return extract(req);
      }),
    ),
  ),
);

// quo_call_events — persists sales CALLS (and their recordings + transcripts)
// into call_logs, so every rep and the AI agent can see what was said on the
// phone. Register a SEPARATE OpenPhone webhook for call events pointing here
// (subscribe: call.completed, call.recording.completed,
// call.transcript.completed) — quo_inbound stays message-only on purpose.
//
// The Inbox UI keeps pulling OpenPhone live (quo_calls proxy); this table is
// the PERMANENT record: it grounds the SMS agent's prompt (lastCallSnippet),
// feeds the LeadContextCard, and survives OpenPhone retention windows.
//
// Auth: OpenPhone HMAC signature (openphone-signature header). Same scheme as
// quo_inbound: OpenPhone signs `${timestamp}.${rawBody}` with the
// BASE64-DECODED webhook key. The key(s) live in integration_secrets under
// SALES_QUO_CALLS_WEBHOOK_SECRET — comma-separated, because OpenPhone issues
// one signing key per webhook and calls + transcripts are separate webhooks.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { toE164, getQuoKey } from "../_shared/quoSales.ts";

async function getWebhookKeys(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "SALES_QUO_CALLS_WEBHOOK_SECRET")
    .maybeSingle();
  const raw = (data?.value ?? "") as string;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

async function verifySignature(rawBody: string, header: string | null, b64Secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(";"); // hmac;1;<timestamp>;<base64sig>
  if (parts.length < 4) return false;
  const timestamp = parts[2];
  const provided = parts[3];
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      b64ToBytes(b64Secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
    const computed = bytesToB64(sig);
    if (computed.length !== provided.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ provided.charCodeAt(i);
    return diff === 0;
  } catch (e) {
    console.error("[quo_call_events] verify error", e);
    return false;
  }
}

const ok = (extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, ...extra }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const firstStr = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""));

async function contactIdByPhone(e164: string): Promise<number | null> {
  if (!e164) return null;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .contains("phone_jsonb", [{ number: e164 }])
    .limit(1);
  return (data && data[0]?.id) ?? null;
}

// The rep who owns the CRM-side number, if any (sales.quo_phone).
async function salesIdByQuoPhone(e164: string): Promise<number | null> {
  if (!e164) return null;
  try {
    const { data } = await supabaseAdmin
      .from("sales")
      .select("id, quo_phone")
      .not("quo_phone", "is", null);
    for (const s of data ?? []) {
      if (toE164(String(s.quo_phone ?? "")) === e164) return s.id as number;
    }
  } catch { /* optional enrichment only */ }
  return null;
}

// Find-or-create the call row keyed by openphone_call_id, then patch it.
async function upsertCallLog(callId: string, patch: Record<string, unknown>): Promise<number | null> {
  const { data: existing } = await supabaseAdmin
    .from("call_logs")
    .select("id")
    .eq("openphone_call_id", callId)
    .limit(1);
  if (existing && existing[0]) {
    const { error } = await supabaseAdmin.from("call_logs").update(patch).eq("id", existing[0].id);
    if (error) console.error("[quo_call_events] update failed", error);
    return existing[0].id as number;
  }
  const { data, error } = await supabaseAdmin
    .from("call_logs")
    .insert({ openphone_call_id: callId, ...patch })
    .select("id")
    .single();
  if (error) {
    console.error("[quo_call_events] insert failed", error);
    return null;
  }
  return data.id as number;
}

function fmtDuration(seconds: unknown): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  return ` (${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s)`;
}

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  const secrets = await getWebhookKeys();
  if (!secrets.length) return createErrorResponse(503, "Call events webhook not configured");

  const raw = await req.text();
  const header = req.headers.get("openphone-signature");
  let verified = false;
  for (const secret of secrets) {
    if (await verifySignature(raw, header, secret)) {
      verified = true;
      break;
    }
  }
  if (!verified) return createErrorResponse(401, "Bad signature");

  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  const type = String(evt?.type ?? "");
  const obj = evt?.data?.object ?? {};

  if (type === "call.completed") {
    const callId = String(obj.id ?? "");
    if (!callId) return ok({ ignored: "no call id" });
    const direction = obj.direction === "incoming" ? "inbound" : "outbound";
    const from = toE164(firstStr(obj.from));
    const to = toE164(firstStr(obj.to));
    const external = direction === "inbound" ? from : to;
    const internal = direction === "inbound" ? to : from;
    const contactId = await contactIdByPhone(external);
    const salesId = await salesIdByQuoPhone(internal);

    const rowId = await upsertCallLog(callId, {
      contact_id: contactId,
      phone_number_id: (obj.phoneNumberId as string) ?? null,
      participant: external || null,
      direction,
      status: String(obj.status ?? "completed"),
      duration: Number.isFinite(Number(obj.duration)) ? Number(obj.duration) : null,
      sales_id: salesId,
      completed_at: (obj.completedAt as string) ?? new Date().toISOString(),
    });

    // Timeline marker so the call shows in the contact's ActivityLog.
    if (rowId && contactId) {
      try {
        await supabaseAdmin.from("contact_notes").insert({
          contact_id: contactId,
          text: `📞 ${direction === "inbound" ? "Inbound" : "Outbound"} call${fmtDuration(obj.duration)} with ${external} — recorded in call log #${rowId}.`,
          date: new Date().toISOString(),
          status: "warm",
        });
      } catch { /* visibility only */ }
    }
    return ok({ call_log_id: rowId });
  }

  if (type === "call.recording.completed") {
    const callId = String(obj.id ?? obj.callId ?? "");
    if (!callId) return ok({ ignored: "no call id" });
    const media = Array.isArray(obj.media) ? obj.media : [];
    const url = media.map((m: any) => m?.url).find((u: unknown) => typeof u === "string" && u) ?? null;
    if (!url) return ok({ ignored: "no media url" });
    const rowId = await upsertCallLog(callId, { recording_url: url });
    return ok({ call_log_id: rowId });
  }

  if (type === "call.transcript.completed") {
    const callId = String(obj.callId ?? obj.id ?? "");
    if (!callId) return ok({ ignored: "no call id" });
    let dialogue = obj.dialogue;
    // Some plans deliver a stub event; fetch the transcript if it's missing.
    if (!Array.isArray(dialogue) || !dialogue.length) {
      try {
        const apiKey = await getQuoKey();
        if (apiKey) {
          const res = await fetch(`https://api.openphone.com/v1/call-transcripts/${encodeURIComponent(callId)}`, {
            headers: { Authorization: apiKey },
          });
          if (res.ok) {
            const body = await res.json();
            dialogue = body?.data?.dialogue ?? body?.dialogue ?? null;
          }
        }
      } catch (e) {
        console.error("[quo_call_events] transcript fetch failed", e);
      }
    }
    if (!Array.isArray(dialogue) || !dialogue.length) return ok({ ignored: "no transcript" });

    // Short gist for prompts/cards: the first few lines of dialogue.
    const summary = dialogue
      .map((d: any) => (d && typeof d === "object" ? String(d.content ?? "") : ""))
      .filter(Boolean)
      .join(" / ")
      .slice(0, 300);
    const rowId = await upsertCallLog(callId, {
      transcript: { dialogue },
      summary: summary || null,
      status: "completed",
    });
    return ok({ call_log_id: rowId });
  }

  // Everything else (ringing, delivery, pings) -> ack.
  return ok({ ignored: type || "unknown" });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

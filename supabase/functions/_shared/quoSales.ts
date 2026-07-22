// Shared OpenPhone (Quo) send helper for the AUTOMATED sales funnel.
//
// Unlike quo_send_sms (which sends from the calling rep's personal quo_phone),
// this sends from the dedicated Robin Line *sales* number used by the AI agent
// + the reminder/nurture engine. Both the API key and the from-number live in
// integration_secrets (RLS-locked, service-role only):
//   QUO_API_KEY              — OpenPhone API key
//   SALES_AGENT_QUO_NUMBER   — the dedicated sales line, E.164 or US digits
//
// Keep this isolated from rep numbers and from robinline-1 client numbers — the
// webhook scoping that prevents cross-tenant SMS bleed depends on it.

import { supabaseAdmin } from "./supabaseAdmin.ts";

const QUO_ENDPOINT = "https://api.openphone.com/v1/messages";

// Accept any US phone format and coerce to E.164 (what Quo requires).
export function toE164(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return "+" + trimmed.replace(/\D/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

async function getSecret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

export const getQuoKey = () => getSecret("QUO_API_KEY");
export const getSalesNumber = () => getSecret("SALES_AGENT_QUO_NUMBER");

// Global kill switch. When integration_secrets.SALES_SENDS_PAUSED == "true",
// the funnel logs leads/appointments into the CRM as usual but sends NO
// automated SMS (speed-to-lead, nurture, reminders, AI agent replies). Toggle
// by updating that one row — no redeploy needed. Missing/anything-but-"true"
// means sends are LIVE (fail-open, so a missing row never silently kills sends).
export async function salesSendsPaused(): Promise<boolean> {
  const v = await getSecret("SALES_SENDS_PAUSED");
  return (v ?? "").trim().toLowerCase() === "true";
}

export interface SendResult {
  ok: boolean;
  status: number;
  body: unknown;
}

// Best-effort persistence of one SMS to the analytics log (sms_messages).
// NEVER throws — logging must never break a send or a webhook. The inbox UI
// reads OpenPhone live, so nothing reads this table yet; it exists to build a
// queryable history for reply-rate / response-time metrics. Direction uses the
// 'inbound'/'outbound' convention (consistent with agent_messages).
export async function logSms(row: {
  contactId: number;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  body: string;
  phoneNumberId?: string | null;
  openphoneMessageId?: string | null;
  salesId?: number | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from("sms_messages").insert({
      contact_id: row.contactId,
      phone_number_id: row.phoneNumberId ?? "",
      from_number: row.fromNumber,
      to_number: row.toNumber,
      body: row.body,
      direction: row.direction,
      openphone_message_id: row.openphoneMessageId ?? null,
      sales_id: row.salesId ?? null,
    });
  } catch (e) {
    console.error("[quoSales] sms_messages log failed", e);
  }
}

/**
 * Did WE send this outbound text (AI agent / dispatcher), or did a human send it
 * from the OpenPhone app? Every automated send logs its OpenPhone message id to
 * sms_messages, so an outbound id we have never seen means a human typed it.
 *
 * The id lookup can lose a race (the webhook may beat our own logSms insert), so
 * an identical outbound body for the same contact in the last few minutes also
 * counts as ours. Both checks fail toward "ours": a false "human" would wrongly
 * mute the funnel for that lead, which is worse than missing one pause.
 */
export async function isOurOutboundMessage(opts: {
  openphoneMessageId: string | null;
  contactId: number | null;
  body: string;
}): Promise<boolean> {
  if (opts.openphoneMessageId) {
    const { data } = await supabaseAdmin
      .from("sms_messages")
      .select("id")
      .eq("openphone_message_id", opts.openphoneMessageId)
      .maybeSingle();
    if (data) return true;
  }

  const body = opts.body.trim();
  if (!opts.contactId || !body) return true;

  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("sms_messages")
    .select("id")
    .eq("contact_id", opts.contactId)
    .eq("direction", "outbound")
    .eq("body", body)
    .gte("created_at", since)
    .limit(1);
  return Boolean(recent && recent.length);
}

// Send one SMS from the sales number. Never throws — returns a structured
// result so callers (the dispatcher) can mark tasks sent/failed and retry.
// Pass opts.contactId to also persist the sent text to sms_messages (best-effort).
export async function sendSalesSms(
  to: string,
  content: string,
  opts?: { contactId?: number | null; salesId?: number | null },
): Promise<SendResult> {
  // Paused? Don't touch OpenPhone. Sentinel result lets callers tell "paused"
  // apart from a real failure (so they cancel the task instead of retrying).
  if (await salesSendsPaused()) {
    return { ok: false, status: 0, body: { paused: true } };
  }

  const key = await getQuoKey();
  if (!key) return { ok: false, status: 500, body: { message: "QUO_API_KEY not set" } };

  const from = toE164(await getSalesNumber());
  if (!from) {
    return {
      ok: false,
      status: 500,
      body: { message: "SALES_AGENT_QUO_NUMBER not set in integration_secrets" },
    };
  }

  const toNumber = toE164(to);
  if (!toNumber) return { ok: false, status: 400, body: { message: `invalid 'to': ${to}` } };

  try {
    const res = await fetch(QUO_ENDPOINT, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ content, from, to: [toNumber] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) console.error("Quo sales send failed:", res.status, body);
    // Persist the sent text for analytics (best-effort; only when we know who).
    if (res.ok && opts?.contactId) {
      const data = (body as { data?: Record<string, unknown> })?.data ?? {};
      await logSms({
        contactId: opts.contactId,
        direction: "outbound",
        fromNumber: from,
        toNumber: toNumber,
        body: content,
        phoneNumberId: (data.phoneNumberId as string) ?? null,
        openphoneMessageId: (data.id as string) ?? null,
        salesId: opts.salesId ?? null,
      });
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    console.error("Quo sales send threw:", e);
    return { ok: false, status: 502, body: { message: String(e) } };
  }
}

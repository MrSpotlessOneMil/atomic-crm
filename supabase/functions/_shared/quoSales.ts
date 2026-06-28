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

// Send one SMS from the sales number. Never throws — returns a structured
// result so callers (the dispatcher) can mark tasks sent/failed and retry.
export async function sendSalesSms(
  to: string,
  content: string,
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
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    console.error("Quo sales send threw:", e);
    return { ok: false, status: 502, body: { message: String(e) } };
  }
}

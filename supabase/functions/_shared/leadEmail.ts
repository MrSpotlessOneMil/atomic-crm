// Headless lead-facing email — sends a WARM nurture email to a lead from the
// closer's connected Gmail (the same Gmail-OAuth mechanism gmail_send uses for
// the manual "Log Call" email, but callable from the cron with no user session).
//
// Used by the automated email drip for lead-magnet opt-ins who gave an email.
// These are WARM, consented leads — distinct from the cold Instantly campaign.
//
// Sender = the closer (integration_secrets.CLOSER_SALES_ID) so replies land with
// the human who closes. If the closer hasn't connected Gmail, we skip gracefully
// (the lead still has the SMS drip + CRM record) and say so.

import { supabaseAdmin } from "./supabaseAdmin.ts";

async function secret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets").select("value").eq("key", key).single();
  return data?.value ?? null;
}

function base64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type LeadEmailResult =
  | { ok: true; skipped?: false }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

// Returns the sales_id whose Gmail we send from: the configured closer, else the
// first admin who has a Gmail token connected.
async function senderSalesId(): Promise<number | null> {
  const cfg = await secret("CLOSER_SALES_ID");
  if (cfg && Number.isFinite(Number(cfg))) {
    const { data } = await supabaseAdmin
      .from("gmail_tokens").select("sales_id").eq("sales_id", Number(cfg)).maybeSingle();
    if (data?.sales_id) return Number(cfg);
  }
  // fallback: any admin with Gmail connected
  const { data: toks } = await supabaseAdmin
    .from("gmail_tokens").select("sales_id").limit(1);
  return toks && toks[0] ? Number(toks[0].sales_id) : null;
}

export async function sendLeadEmail(opts: {
  to: string;
  subject: string;
  body: string;            // plain text
  contactId: number | null;
  dealId: number | null;
  taskType?: string;
}): Promise<LeadEmailResult> {
  const sid = await senderSalesId();
  if (!sid) return { ok: false, skipped: true, reason: "no closer Gmail connected" };

  const { data: tok } = await supabaseAdmin
    .from("gmail_tokens").select("refresh_token, email").eq("sales_id", sid).single();
  if (!tok?.refresh_token) return { ok: false, skipped: true, reason: "no refresh token" };

  const clientId = await secret("GOOGLE_CLIENT_ID");
  const clientSecret = await secret("GOOGLE_CLIENT_SECRET");
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId ?? "", client_secret: clientSecret ?? "",
      refresh_token: tok.refresh_token, grant_type: "refresh_token",
    }),
  });
  const refreshed = await refreshRes.json().catch(() => ({}));
  if (!refreshRes.ok || !refreshed.access_token) {
    return { ok: false, error: "gmail token refresh failed" };
  }

  const from = tok.email ?? "";
  const mime = [
    `To: ${opts.to}`,
    `From: ${from}`,
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.body,
  ].join("\r\n");

  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshed.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: base64url(mime) }),
    },
  );
  if (!sendRes.ok) {
    const detail = await sendRes.text().catch(() => "");
    return { ok: false, error: `gmail ${sendRes.status}: ${detail}`.slice(0, 400) };
  }

  // Timeline + machine transcript (mirrors the SMS path).
  if (opts.contactId) {
    try {
      await supabaseAdmin.from("contact_notes").insert({
        contact_id: opts.contactId, sales_id: sid,
        text: `📧 Auto-email (${opts.taskType ?? "nurture"}) -> ${opts.to}\nSubject: ${opts.subject}\n\n${opts.body}`,
        date: new Date().toISOString(), status: "warm",
      });
    } catch (_e) { /* visibility only */ }
    try {
      await supabaseAdmin.from("agent_messages").insert({
        contact_id: opts.contactId, deal_id: opts.dealId, direction: "outbound",
        body: `[email] ${opts.subject}\n${opts.body}`,
      });
    } catch (_e) { /* transcript only */ }
  }
  return { ok: true };
}

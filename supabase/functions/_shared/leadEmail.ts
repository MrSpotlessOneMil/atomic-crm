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
//
// Threading: callers may pass a messageIdHeader when sending (we stamp our own
// RFC 5322 Message-ID so no Gmail read scope is needed later) and inReplyTo /
// threadId when replying — that's how the day-3 follow-up lands INSIDE the
// opener's thread instead of as a cold new email.

import { supabaseAdmin } from "./supabaseAdmin.ts";

async function secret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

function base64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type LeadEmailResult =
  | { ok: true; skipped?: false; gmailId?: string; threadId?: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

// Returns the sales_id whose Gmail we send from: the configured closer, else the
// first sales user who has a Gmail token connected.
export async function senderSalesId(): Promise<number | null> {
  const cfg = await secret("CLOSER_SALES_ID");
  if (cfg && Number.isFinite(Number(cfg))) {
    const { data } = await supabaseAdmin
      .from("gmail_tokens")
      .select("sales_id")
      .eq("sales_id", Number(cfg))
      .maybeSingle();
    if (data?.sales_id) return Number(cfg);
  }
  const { data: toks } = await supabaseAdmin
    .from("gmail_tokens")
    .select("sales_id")
    .limit(1);
  return toks && toks[0] ? Number(toks[0].sales_id) : null;
}

export type GmailSession =
  | {
      ok: true;
      salesId: number;
      email: string;
      accessToken: string;
      /** Scopes Google actually granted this token (not a secret) — lets the
       *  reply scan report precisely what's missing instead of guessing. */
      scope?: string;
    }
  | { ok: false; reason: string; transient?: boolean };

// Refresh an access token for the drip sender's Gmail. Shared by the outbound
// drip (sendLeadEmail) and the inbound reply scan (gmail_reply_scan).
export async function gmailSession(): Promise<GmailSession> {
  const sid = await senderSalesId();
  if (!sid) return { ok: false, reason: "no closer Gmail connected" };

  const { data: tok } = await supabaseAdmin
    .from("gmail_tokens")
    .select("refresh_token, email")
    .eq("sales_id", sid)
    .single();
  if (!tok?.refresh_token) return { ok: false, reason: "no refresh token" };

  const clientId = await secret("GOOGLE_CLIENT_ID");
  const clientSecret = await secret("GOOGLE_CLIENT_SECRET");
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      refresh_token: tok.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const refreshed = await refreshRes.json().catch(() => ({}));
  if (!refreshRes.ok || !refreshed.access_token) {
    // invalid_grant = the token is revoked (permanent -> skip); anything else
    // (network blip, 5xx, rate limit) is transient and must be RETRIED, not
    // silently cancel a lead's whole email drip.
    const permanent =
      refreshRes.status === 400 &&
      String((refreshed as { error?: string }).error ?? "").includes(
        "invalid_grant",
      );
    return {
      ok: false,
      reason: permanent ? "gmail token revoked" : "gmail token refresh failed",
      transient: !permanent,
    };
  }
  return {
    ok: true,
    salesId: sid,
    email: tok.email ?? "",
    accessToken: refreshed.access_token,
    scope: typeof refreshed.scope === "string" ? refreshed.scope : undefined,
  };
}

// RFC 2047 encoded-word for non-ASCII header values (Spanish subjects would
// otherwise ship as raw UTF-8 bytes in the header).
function encodeHeaderWord(value: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

export async function sendLeadEmail(opts: {
  to: string;
  subject: string;
  body: string; // plain text
  contactId: number | null;
  dealId: number | null;
  taskType?: string;
  messageIdHeader?: string; // our own Message-ID for the outgoing mail
  inReplyTo?: string; // Message-ID of the mail we're replying to
  threadId?: string; // Gmail thread to attach to
}): Promise<LeadEmailResult> {
  const session = await gmailSession();
  if (!session.ok) {
    // Transient session failures surface as retryable errors so the dispatcher
    // backs off and retries instead of canceling the task.
    if (session.transient) return { ok: false, error: session.reason };
    return { ok: false, skipped: true, reason: session.reason };
  }

  const headers = [
    `To: ${opts.to}`,
    `From: ${session.email}`,
    `Subject: ${encodeHeaderWord(opts.subject)}`,
  ];
  if (opts.messageIdHeader) headers.push(`Message-ID: ${opts.messageIdHeader}`);
  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    headers.push(`References: ${opts.inReplyTo}`);
  }
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  const mime = [...headers, "", opts.body].join("\r\n");

  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: base64url(mime),
        ...(opts.threadId ? { threadId: opts.threadId } : {}),
      }),
    },
  );
  if (!sendRes.ok) {
    const detail = await sendRes.text().catch(() => "");
    return {
      ok: false,
      error: `gmail ${sendRes.status}: ${detail}`.slice(0, 400),
    };
  }
  const sent = await sendRes.json().catch(() => ({}));

  // Timeline + machine transcript (mirrors the SMS path).
  if (opts.contactId) {
    try {
      await supabaseAdmin.from("contact_notes").insert({
        contact_id: opts.contactId,
        sales_id: session.salesId,
        text: `📧 Auto-email (${opts.taskType ?? "nurture"}) -> ${opts.to}\nSubject: ${opts.subject}\n\n${opts.body}`,
        date: new Date().toISOString(),
        status: "warm",
      });
    } catch (_e) {
      /* visibility only */
    }
    try {
      await supabaseAdmin.from("agent_messages").insert({
        contact_id: opts.contactId,
        deal_id: opts.dealId,
        direction: "outbound",
        body: `[email] ${opts.subject}\n${opts.body}`,
      });
    } catch (_e) {
      /* transcript only */
    }
  }
  return {
    ok: true,
    gmailId: typeof sent.id === "string" ? sent.id : undefined,
    threadId: typeof sent.threadId === "string" ? sent.threadId : undefined,
  };
}

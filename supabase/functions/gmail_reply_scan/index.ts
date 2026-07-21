// gmail_reply_scan — detects LEAD REPLIES to the automated email drip.
//
// The drip sends from the closer's Gmail (see _shared/leadEmail.ts), so lead
// replies land in that Gmail INBOX where no webhook can see them. This sweep
// closes the loop: every few minutes (pg_cron, see CRON_SETUP.sql) it lists
// recent inbox messages, matches senders against contacts who currently have an
// active cadence, and for each real reply halts ALL automated follow-up
// (haltFollowup), records it on the timeline + machine transcript, and pings
// the rep (lead_replied notification — the human 5-minute SLA).
//
// Correctness rules (a MISSED reply means we keep texting someone who
// answered, so this errs on the side of at-least-once):
//   * Pagination: messages.list is walked page by page until a page dips below
//     the cursor — never just the first 50.
//   * The cursor only advances when EVERY message this run was fetched
//     successfully; any failure leaves it put so the next run re-scans.
//     Re-processing is harmless (haltFollowup is idempotent).
//   * Auto-replies (out-of-office etc.) do NOT halt the cadence — they're
//     logged as a note only.
//   * A short "stop/unsubscribe" reply also writes email_suppressions, making
//     the drip footer's promise machine-enforced.
//
// Requires the gmail.readonly scope on the closer's Gmail connection (the
// Settings page requests it since 2026-07-17; older connections must reconnect
// once). Only metadata headers are read; bodies are never fetched.
//
// Auth: X-DISPATCH-TOKEN == DISPATCH_TASKS_TOKEN (same trust domain: pg_cron).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { gmailSession } from "../_shared/leadEmail.ts";
import {
  haltFollowup,
  notifyLeadReplied,
  CHASE_TASK_TYPES,
} from "../_shared/haltFollowup.ts";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const CURSOR_KEY = "GMAIL_REPLY_SCAN_CURSOR";

const STOP_INTENT_RE = /\b(stop|unsubscribe|remove me|no more emails?)\b/i;
const AUTO_REPLY_SUBJECT_RE =
  /out of (the )?office|automatic reply|autoreply|auto-reply|vacation|away from/i;

function emailsOf(jsonb: unknown): string[] {
  if (!Array.isArray(jsonb)) return [];
  const out: string[] = [];
  for (const e of jsonb) {
    const v =
      e && typeof e === "object" ? (e as Record<string, unknown>).email : e;
    if (typeof v === "string" && v.includes("@"))
      out.push(v.trim().toLowerCase());
  }
  return out;
}

// address out of a From header ("Jane Doe <jane@x.com>" -> "jane@x.com").
function addressOf(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

async function getCursor(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", CURSOR_KEY)
    .maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : Date.now() - 24 * 3600_000;
}

async function setCursor(ms: number): Promise<void> {
  await supabaseAdmin
    .from("integration_secrets")
    .upsert({ key: CURSOR_KEY, value: String(ms) }, { onConflict: "key" });
}

const jsonOk = (body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: true, ...body }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const handle = async (req: Request) => {
  if (req.method !== "POST")
    return createErrorResponse(405, "Method Not Allowed");

  const expected = Deno.env.get("DISPATCH_TASKS_TOKEN");
  const provided = req.headers.get("X-DISPATCH-TOKEN");
  if (!expected || provided !== expected)
    return createErrorResponse(401, "Unauthorized");

  const session = await gmailSession();
  if (!session.ok) {
    // No Gmail connected -> nothing to scan; not an error (SMS drip still runs).
    return jsonOk({ skipped: session.reason });
  }

  // Watch set: every contact with an active (pending) cadence, keyed by email.
  // Cheap: pending chase tasks are a few hundred rows at most.
  const { data: pendingTasks } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("contact_id")
    .eq("status", "pending")
    .in("task_type", CHASE_TASK_TYPES)
    .not("contact_id", "is", null);
  const watchIds = [
    ...new Set(
      (pendingTasks ?? []).map((t: { contact_id: number }) => t.contact_id),
    ),
  ];
  if (!watchIds.length) return jsonOk({ watched: 0, matched: 0 });

  const byEmail = new Map<string, number>();
  for (let i = 0; i < watchIds.length; i += 100) {
    const { data: watchContacts } = await supabaseAdmin
      .from("contacts")
      .select("id, email_jsonb")
      .in("id", watchIds.slice(i, i + 100));
    for (const c of watchContacts ?? []) {
      for (const e of emailsOf((c as { email_jsonb: unknown }).email_jsonb)) {
        byEmail.set(e, (c as { id: number }).id);
      }
    }
  }
  if (!byEmail.size) return jsonOk({ watched: 0, matched: 0 });

  const cursor = await getCursor();
  const auth = { Authorization: `Bearer ${session.accessToken}` };

  // Collect ALL message ids past the cursor, page by page. Gmail lists newest
  // first, so once a whole page is <= cursor we can stop — but we only learn a
  // message's internalDate from the metadata fetch, so pages are cut by count
  // and the per-message cursor check below does the precise filtering.
  const ids: string[] = [];
  let pageToken: string | undefined;
  let listFailed = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent("in:inbox -from:me newer_than:2d")}&maxResults=${PAGE_SIZE}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const listRes = await fetch(url, { headers: auth });
    if (listRes.status === 403) {
      // gmail.readonly not granted on this connection yet — say so loudly and
      // DO NOT advance the cursor; detection starts working after a reconnect.
      // Report the scopes Google ACTUALLY granted (not secrets) so the fix is
      // obvious: a stale cached bundle asking for the old scopes looks exactly
      // like the scope being blocked in the Google Cloud consent screen, and
      // only the granted list tells them apart.
      console.error(
        "[gmail_reply_scan] 403 — gmail.readonly missing for",
        session.email,
        "granted:",
        session.scope,
      );
      return jsonOk({
        skipped: "gmail.readonly scope not granted — reconnect Gmail",
        account: session.email,
        granted_scopes: session.scope ?? "(not reported)",
      });
    }
    if (!listRes.ok) {
      console.error("[gmail_reply_scan] list failed", listRes.status);
      listFailed = true;
      break;
    }
    const list = await listRes.json().catch(() => ({}));
    const msgs: { id: string }[] = Array.isArray(list.messages)
      ? list.messages
      : [];
    ids.push(...msgs.map((m) => m.id));
    pageToken =
      typeof list.nextPageToken === "string" ? list.nextPageToken : undefined;
    if (!pageToken) break;
  }
  const pagesExhausted = !!pageToken; // hit MAX_PAGES with more remaining

  let matched = 0;
  let maxSeen = cursor;
  let anyFetchFailed = listFailed || pagesExhausted;
  for (const id of ids) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Auto-Submitted&metadataHeaders=Precedence`,
      { headers: auth },
    );
    if (!msgRes.ok) {
      anyFetchFailed = true;
      continue;
    }
    const msg = await msgRes.json().catch(() => null);
    if (!msg) {
      anyFetchFailed = true;
      continue;
    }
    const internal = Number(msg.internalDate);
    if (!Number.isFinite(internal) || internal <= cursor) continue;
    if (internal > maxSeen) maxSeen = internal;

    const headers: { name: string; value: string }[] =
      msg.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";
    const sender = addressOf(header("From"));
    const contactId = byEmail.get(sender);
    if (!contactId) continue;

    const subject = header("Subject");
    const snippet = String(msg.snippet ?? "").slice(0, 500);

    // Auto-replies are not a human response: log for visibility, keep the
    // cadence running, no SLA ping.
    const autoSubmitted = header("Auto-Submitted");
    const isAutoReply =
      (autoSubmitted && autoSubmitted.toLowerCase() !== "no") ||
      /auto[_-]?reply/i.test(header("Precedence")) ||
      AUTO_REPLY_SUBJECT_RE.test(subject);
    if (isAutoReply) {
      try {
        await supabaseAdmin.from("contact_notes").insert({
          contact_id: contactId,
          text: `📥 Auto-reply email detected (subject: ${subject || "(none)"}) — cadence NOT stopped.`,
          date: new Date().toISOString(),
          status: "warm",
        });
      } catch {
        /* visibility only */
      }
      continue;
    }

    matched++;

    // A short stop/unsubscribe reply = opt out of email, machine-enforced.
    if (snippet.length < 120 && STOP_INTENT_RE.test(snippet)) {
      await supabaseAdmin
        .from("email_suppressions")
        .upsert(
          { email: sender, reason: "email_stop", contact_id: contactId },
          { onConflict: "email" },
        );
    }

    // Transcript + timeline, then halt everything and ping the human.
    try {
      await supabaseAdmin.from("agent_messages").insert({
        contact_id: contactId,
        deal_id: null,
        direction: "inbound",
        body: `[email] ${subject}\n${snippet}`.slice(0, 4000),
      });
    } catch {
      /* transcript only */
    }
    await haltFollowup({
      contactId,
      reason: "email_reply",
      note: `📥 Email reply detected in ${session.email}'s inbox (subject: ${subject || "(none)"}) — automated follow-up stopped.`,
    });
    await notifyLeadReplied({
      contactId,
      channel: "email",
      preview: snippet || subject,
    });
  }

  // At-least-once: only advance the cursor on a fully clean run. A re-scan of
  // already-handled replies is a no-op; a skipped reply is a lead being spammed.
  if (!anyFetchFailed && maxSeen > cursor) await setCursor(maxSeen);

  return jsonOk({
    watched: byEmail.size,
    scanned: ids.length,
    matched,
    cursor_advanced: !anyFetchFailed && maxSeen > cursor,
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

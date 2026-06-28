// dispatch_tasks — drains the scheduled_tasks queue.
//
// Triggered by pg_cron every minute (via pg_net), exactly like weekly_digest is
// designed to be. Auth is the X-DISPATCH-TOKEN header compared to the
// DISPATCH_TASKS_TOKEN function secret, so the cron job can call it without a
// JWT. Sends from the dedicated sales number (see _shared/quoSales.ts).
//
// Most tasks are SMS: claim → opt-out guard → quiet-hours defer → render → send
// → mark. A few are "action" tasks (e.g. no_show_check) handled inline.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { sendSalesSms, toE164, salesSendsPaused } from "../_shared/quoSales.ts";
import { NO_SHOW } from "../_shared/salesCopy.ts";
import { sendLeadEmail } from "../_shared/leadEmail.ts";

const EMAIL_TASK_TYPES = ["speed_to_lead_email", "nurture_email"];

const BATCH = 25;
const MAX_ATTEMPTS = 5;
const DEFAULT_CALENDLY = "https://calendly.com/dominic-theosirisai/cleaning-gameplan";

interface TaskRow {
  id: number;
  deal_id: number | null;
  contact_id: number | null;
  task_type: string;
  payload: Record<string, unknown>;
  run_at: string;
  attempts: number;
}

// contacts.phone_jsonb is an array of { number, type } (or, defensively, strings).
function firstPhone(
  contact: { phone_jsonb?: unknown } | null,
  payloadTo?: unknown,
): string | null {
  if (typeof payloadTo === "string" && payloadTo.trim()) return payloadTo;
  const pj = contact?.phone_jsonb;
  if (Array.isArray(pj)) {
    for (const entry of pj) {
      if (typeof entry === "string" && entry.trim()) return entry;
      if (entry && typeof entry === "object") {
        const n = (entry as Record<string, unknown>).number;
        if (typeof n === "string" && n.trim()) return n;
      }
    }
  }
  return null;
}

// Quiet hours: no automated SMS before 8am or at/after 8pm in the lead's tz.
// TODO(Phase 1): set payload.tz from the lead's area code at enqueue time.
function isQuietHours(tz: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    }).formatToParts(new Date());
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10) % 24;
    return h < 8 || h >= 20;
  } catch {
    return false; // unknown tz → don't block the send
  }
}

function render(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? "");
}

// Optimistic claim: pending → processing. Returns false if another worker won.
async function claim(id: number): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("scheduled_tasks")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  return !!(data && data.length);
}

async function setStatus(id: number, fields: Record<string, unknown>) {
  await supabaseAdmin
    .from("scheduled_tasks")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function getCalendlyUrl(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "CALENDLY_BOOKING_URL")
    .single();
  return data?.value ?? DEFAULT_CALENDLY;
}

type Outcome = "sent" | "skipped" | "deferred" | "failed";

// A demo whose deal is STILL 'demo-booked' after the demo window = probable
// no-show. If a human already moved it (demo-done / won / lost), do nothing.
async function handleNoShowCheck(task: TaskRow): Promise<Outcome> {
  if (!task.contact_id) {
    await setStatus(task.id, { status: "canceled", last_error: "no contact" });
    return "skipped";
  }
  const { data: deals } = await supabaseAdmin
    .from("deals")
    .select("id, stage")
    .contains("contact_ids", [task.contact_id])
    .eq("stage", "demo-booked")
    .limit(1);
  const deal = deals?.[0];
  if (!deal) {
    await setStatus(task.id, { status: "sent" }); // showed up / disposed
    return "skipped";
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, phone_jsonb")
    .eq("id", task.contact_id)
    .maybeSingle();
  const phone = firstPhone(contact ?? null);
  if (!phone) {
    await setStatus(task.id, { status: "failed", last_error: "no phone" });
    return "failed";
  }
  const { data: sup } = await supabaseAdmin
    .from("sms_suppressions")
    .select("id")
    .eq("phone", toE164(phone))
    .maybeSingle();
  if (sup) {
    await setStatus(task.id, { status: "canceled", last_error: "suppressed" });
    return "skipped";
  }

  const content = render(NO_SHOW, {
    first_name: (contact?.first_name ?? "").split(" ")[0] || "there",
    calendly_link: await getCalendlyUrl(),
  });
  const res = await sendSalesSms(phone, content);
  if (!res.ok) {
    await setStatus(task.id, { status: "failed", last_error: JSON.stringify(res.body).slice(0, 500) });
    return "failed";
  }
  await supabaseAdmin.from("deals").update({ stage: "contacted", updated_at: new Date().toISOString() }).eq("id", deal.id);
  await supabaseAdmin.from("agent_messages").insert({ contact_id: task.contact_id, deal_id: deal.id, direction: "outbound", body: content });
  try {
    await supabaseAdmin.from("contact_notes").insert({
      contact_id: task.contact_id,
      text: `🤖 No-show recovery -> ${phone}:\n${content}`,
      date: new Date().toISOString(),
      status: "warm",
    });
  } catch (_e) { /* visibility only */ }
  await setStatus(task.id, { status: "sent" });
  return "sent";
}

// Email drip task (warm lead-magnet opt-ins). No phone needed; no quiet-hours
// (email is fine anytime). Sends from the closer's Gmail via sendLeadEmail.
async function handleEmailTask(task: TaskRow): Promise<Outcome> {
  const payload = task.payload ?? {};
  if (!task.contact_id) {
    await setStatus(task.id, { status: "canceled", last_error: "no contact" });
    return "skipped";
  }
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, email_jsonb")
    .eq("id", task.contact_id)
    .maybeSingle();
  // pull first email from contacts.email_jsonb ([{email,type}] or strings)
  let email: string | null = (typeof payload.to === "string" && payload.to.includes("@")) ? payload.to : null;
  const ej = contact?.email_jsonb;
  if (!email && Array.isArray(ej)) {
    for (const e of ej) {
      if (typeof e === "string" && e.includes("@")) { email = e; break; }
      if (e && typeof e === "object") {
        const v = (e as Record<string, unknown>).email;
        if (typeof v === "string" && v.includes("@")) { email = v; break; }
      }
    }
  }
  if (!email) {
    await setStatus(task.id, { status: "failed", last_error: "no email for task" });
    return "failed";
  }
  const vars = { first_name: (contact?.first_name ?? "").split(" ")[0] || "there" };
  const subject = render(String(payload.subject ?? ""), vars);
  const body = render(String(payload.content ?? ""), vars);
  if (!subject.trim() || !body.trim()) {
    await setStatus(task.id, { status: "failed", last_error: "empty email content" });
    return "failed";
  }
  const res = await sendLeadEmail({
    to: email, subject, body, contactId: task.contact_id, dealId: task.deal_id, taskType: task.task_type,
  });
  if (res.ok) {
    await setStatus(task.id, { status: "sent" });
    return "sent";
  }
  if ("skipped" in res && res.skipped) {
    // e.g. closer hasn't connected Gmail — cancel (don't retry forever) + flag.
    await setStatus(task.id, { status: "canceled", last_error: `email skipped: ${res.reason}` });
    return "skipped";
  }
  const attempts = (task.attempts ?? 0) + 1;
  const errBody = ("error" in res ? res.error : "send failed").slice(0, 500);
  if (attempts < MAX_ATTEMPTS) {
    await setStatus(task.id, {
      status: "pending", attempts,
      run_at: new Date(Date.now() + attempts * 5 * 60_000).toISOString(),
      last_error: errBody,
    });
    return "deferred";
  }
  await setStatus(task.id, { status: "failed", attempts, last_error: errBody });
  return "failed";
}

async function processTask(task: TaskRow): Promise<Outcome> {
  const payload = task.payload ?? {};

  // Action tasks (non-SMS) branch out first.
  if (task.task_type === "no_show_check") return await handleNoShowCheck(task);
  if (EMAIL_TASK_TYPES.includes(task.task_type)) return await handleEmailTask(task);

  // Stale guard: time-sensitive tasks (e.g. reminders) cancel themselves if
  // their window has passed (e.g. quiet-hours pushed them past the demo).
  if (payload.skip_after && Date.now() > Date.parse(String(payload.skip_after))) {
    await setStatus(task.id, { status: "canceled", last_error: "window passed" });
    return "skipped";
  }

  let contact:
    | { id: number; first_name: string | null; phone_jsonb: unknown }
    | null = null;
  if (task.contact_id) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, first_name, phone_jsonb")
      .eq("id", task.contact_id)
      .maybeSingle();
    contact = data ?? null;
  }

  const phone = firstPhone(contact, payload.to);
  if (!phone) {
    await setStatus(task.id, { status: "failed", last_error: "no phone for task" });
    return "failed";
  }

  // Opt-out suppression (STOP / manual).
  const { data: sup } = await supabaseAdmin
    .from("sms_suppressions")
    .select("id")
    .eq("phone", toE164(phone))
    .maybeSingle();
  if (sup) {
    await setStatus(task.id, { status: "canceled", last_error: "suppressed (opt-out)" });
    return "skipped";
  }

  // Quiet hours → re-defer an hour; the next tick re-checks until in-window.
  const tz = (payload.tz as string) || Deno.env.get("QUIET_HOURS_TZ") || "America/New_York";
  if (isQuietHours(tz)) {
    await setStatus(task.id, {
      status: "pending",
      run_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    return "deferred";
  }

  const content = render(String(payload.content ?? ""), {
    first_name: (contact?.first_name ?? "").split(" ")[0] || "there",
  });
  if (!content.trim()) {
    await setStatus(task.id, { status: "failed", last_error: "empty content" });
    return "failed";
  }

  const res = await sendSalesSms(phone, content);
  if (res.ok) {
    await setStatus(task.id, { status: "sent" });
    if (task.contact_id) {
      // Keep the agent's machine transcript complete (opener, nurture, reminders)
      // so it has full context when the lead replies.
      try {
        await supabaseAdmin.from("agent_messages").insert({
          contact_id: task.contact_id,
          deal_id: task.deal_id,
          direction: "outbound",
          body: content,
        });
      } catch (e) {
        console.error("[dispatch_tasks] agent_messages log failed", e);
      }
      try {
        await supabaseAdmin.from("contact_notes").insert({
          contact_id: task.contact_id,
          text: `🤖 Auto-SMS (${task.task_type}) -> ${phone}:\n${content}`,
          date: new Date().toISOString(),
          status: "warm",
        });
      } catch (e) {
        console.error("[dispatch_tasks] note log failed", e);
      }
    }
    return "sent";
  }

  // Transient send failure → backoff retry, else give up.
  const attempts = (task.attempts ?? 0) + 1;
  const errBody = JSON.stringify(res.body).slice(0, 500);
  if (attempts < MAX_ATTEMPTS) {
    await setStatus(task.id, {
      status: "pending",
      attempts,
      run_at: new Date(Date.now() + attempts * 2 * 60_000).toISOString(),
      last_error: errBody,
    });
    return "deferred";
  }
  await setStatus(task.id, { status: "failed", attempts, last_error: errBody });
  return "failed";
}

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  const expected = Deno.env.get("DISPATCH_TASKS_TOKEN");
  const provided = req.headers.get("X-DISPATCH-TOKEN");
  if (!expected || provided !== expected) return createErrorResponse(401, "Unauthorized");

  // Global pause: drain the due queue to 'canceled' (no sends, no retries) so
  // the every-minute cron stops churning. CRM logging happens elsewhere.
  if (await salesSendsPaused()) {
    const { data: canceled } = await supabaseAdmin
      .from("scheduled_tasks")
      .update({ status: "canceled", last_error: "sends paused", updated_at: new Date().toISOString() })
      .eq("status", "pending")
      .lte("run_at", new Date().toISOString())
      .select("id");
    return new Response(JSON.stringify({ ok: true, paused: true, canceled: canceled?.length ?? 0 }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const { data: due } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("id, deal_id, contact_id, task_type, payload, run_at, attempts")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(BATCH);

  const summary: Record<string, number> = {
    processed: 0,
    sent: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
  };

  for (const task of (due ?? []) as TaskRow[]) {
    if (!(await claim(task.id))) continue; // lost the race
    summary.processed++;
    try {
      summary[await processTask(task)]++;
    } catch (e) {
      console.error("[dispatch_tasks] task threw", task.id, e);
      await setStatus(task.id, { status: "failed", last_error: String(e).slice(0, 500) });
      summary.failed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

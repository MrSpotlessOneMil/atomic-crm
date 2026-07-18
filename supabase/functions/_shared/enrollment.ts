// Single place a warm lead gets put on the full drip: instant speed-to-lead
// SMS + email, the nurture sequences, and the human double-dial call cadence.
//
// Callers: lead_inbound (every opt-in POST), enroll_orphans (the safety-net
// sweep that catches leads inserted by ANY other path, e.g. the Zapier that
// writes Meta leads straight into contacts), and public_lead (quote form).
// Keeping enrollment here guarantees a lead can never be "in the CRM but not
// being worked" no matter which door they came through.
//
// Cadence: the Hormozi playbook (see salesCopy.ts) - 3 texts day 1, one a day
// through day 7, close-out day 10, long-term nurture at day 35/90; 3 emails
// (minute 0 / day 3 threaded / day 8); 11 double-dial call sessions over 7
// days (callCadence.ts). Spanish leads get the ES track end-to-end.
//
// Every messaging row carries enrolled_at (the dispatcher's replied-guard needs
// it) and tz (from the lead's area code, else QUIET_HOURS_TZ) so quiet hours
// run on the LEAD's clock.

import { supabaseAdmin } from "./supabaseAdmin.ts";
import {
  NURTURE,
  NURTURE_ES,
  LONGTERM_SMS,
  LONGTERM_SMS_ES,
  EMAIL_OPENER,
  EMAIL_OPENER_ES,
  EMAIL_NURTURE,
  EMAIL_NURTURE_ES,
  LONGTERM_EMAIL,
  LONGTERM_EMAIL_ES,
  STOP_LINE,
  OPENER,
  render,
  type Lang,
  type EmailStep,
} from "./salesCopy.ts";
import { openerForSource, isColdSource } from "./leadPlaybooks.ts";
import {
  contactIdsByIdentity,
  hasRecentSmsCadence,
  hasRecentEmailCadence,
  hasRecentCallCadence,
} from "./contactIdentity.ts";
import { buildCallCadenceRows } from "./callCadence.ts";
import { tzForPhone } from "./areaTz.ts";

const envGet = (name: string): string | undefined =>
  (
    globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }
  ).Deno?.env?.get?.(name);

const repName = () => envGet("SALES_AGENT_NAME") || "Robin";

const DEFAULT_CALENDLY =
  "https://calendly.com/dominic-theosirisai/cleaning-gameplan";

async function calendlyUrl(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "CALENDLY_BOOKING_URL")
    .single();
  return data?.value ?? DEFAULT_CALENDLY;
}

// Abuse cap shared by every enrollment door: if a flood of tasks appeared in
// the last hour (e.g. someone hammering a public form), record the lead but
// stop auto-texting so the number can't be used to mass-blast SMS. Also acts
// as a natural rate limit for the orphan sweep's backfill.
const FLOOD_CAP_PER_HOUR = 60;

export interface EnrollInput {
  contactId: number;
  dealId: number | null;
  source: string; // normalized lead source (leadSource())
  magnet?: string;
  e164?: string | null;
  email?: string | null;
  language?: Lang; // "es" -> Spanish track end-to-end (default "en")
}

export interface EnrollResult {
  enqueued: number;
  callSteps: number;
  skipped?: string; // reason when nothing was enqueued
}

export async function enrollLeadCadence(
  input: EnrollInput,
): Promise<EnrollResult> {
  const { contactId, dealId, source } = input;
  const e164 = input.e164 || null;
  const email = input.email || null;
  const magnet = input.magnet || "";
  const language: Lang = input.language === "es" ? "es" : "en";

  // Cold sources (cold-call / cold-email) are worked by the outbound AUDIT
  // play, not the warm opt-in drip.
  if (isColdSource(source))
    return { enqueued: 0, callSteps: 0, skipped: "cold source" };
  if (!e164 && !email)
    return { enqueued: 0, callSteps: 0, skipped: "no phone or email" };

  // Dedupe by IDENTITY (every contact sharing this phone/email), not just this
  // contact_id - so a duplicate contact can never double-text or double-dial.
  // PER CHANNEL: the common partial-then-full flow (email-only opt-in, phone
  // arrives later) must still start the SMS drip even though the email drip
  // already exists.
  const identityIds = await contactIdsByIdentity(e164, email);
  if (!identityIds.includes(contactId)) identityIds.push(contactId);

  // Already in a live conversation (replied by SMS/email or a real phone
  // call - all land in agent_messages as inbound)? The human/agent owns them;
  // layering a 90-day chase on top is exactly what the owner banned.
  const { data: inbound } = await supabaseAdmin
    .from("agent_messages")
    .select("id")
    .in("contact_id", identityIds)
    .eq("direction", "inbound")
    .limit(1);
  if (inbound && inbound.length) {
    return { enqueued: 0, callSteps: 0, skipped: "in conversation" };
  }

  let smsExists = e164 ? await hasRecentSmsCadence(identityIds) : true;
  let emailExists = email ? await hasRecentEmailCadence(identityIds) : true;
  let callExists = e164 ? await hasRecentCallCadence(identityIds) : true;
  if (smsExists && emailExists && callExists) {
    console.warn(
      "[enrollment] cadence already active for this identity - skipping",
      { contactId },
    );
    return { enqueued: 0, callSteps: 0, skipped: "cadence already active" };
  }

  const { count: recentTasks } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("*", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((recentTasks ?? 0) > FLOOD_CAP_PER_HOUR) {
    console.warn("[enrollment] flood cap hit - skipping auto-cadence", {
      contactId,
      recentTasks,
    });
    return { enqueued: 0, callSteps: 0, skipped: "flood cap" };
  }

  // We enqueue even while sends are paused: dispatch_tasks HOLDS the queue
  // during a pause, so tasks just wait and flush when sends resume. This
  // guarantees no lead is ever logged without a cadence.
  // opener_context: the email opener's first line - true whether or not the
  // lead grabbed a magnet (a robinline.com demo request never "downloaded"
  // anything, so "you just grabbed X" would open with a lie).
  const openerContext = magnet
    ? language === "es"
      ? `Acabas de descargar ${magnet} - buen comienzo.`
      : `You just grabbed ${magnet} - solid start.`
    : language === "es"
      ? "Nos escribiste para automatizar las llamadas y citas de tu negocio de limpieza - buen movimiento."
      : "You just reached out about automating your cleaning business's calls and bookings - good move.";
  const vars = {
    rep_name: repName(),
    lead_magnet:
      magnet ||
      (language === "es" ? "tus plantillas gratis" : "your free templates"),
    opener_context: openerContext,
    calendly_link: await calendlyUrl(),
  };
  const now = Date.now();
  const enrolledAt = new Date(now).toISOString();
  // Quiet hours + call sessions on the LEAD's clock when the area code tells
  // us; else the global setting.
  const tz = tzForPhone(e164) || envGet("QUIET_HOURS_TZ") || undefined;
  const baseMsgPayload = { enrolled_at: enrolledAt, ...(tz ? { tz } : {}) };
  const rows: Record<string, unknown>[] = [];

  // SMS cadence - only when we have a phone and no SMS drip exists yet. Opener
  // voice is picked by source (see leadPlaybooks.ts) so social/website/audit
  // each open differently. The opener alone carries the one-time opt-out line
  // (playbook + A2P hygiene).
  if (e164 && !smsExists) {
    const opener = render(
      openerForSource(source, magnet, language) ?? OPENER,
      vars,
    );
    rows.push({
      task_type: "speed_to_lead_sms",
      contact_id: contactId,
      deal_id: dealId,
      payload: {
        content: `${opener}\n${STOP_LINE[language]}`,
        key: "opener",
        ...baseMsgPayload,
      },
      run_at: new Date(now).toISOString(),
    });
    const nurture = language === "es" ? NURTURE_ES : NURTURE;
    const longterm = language === "es" ? LONGTERM_SMS_ES : LONGTERM_SMS;
    for (const s of [...nurture, ...longterm]) {
      rows.push({
        task_type: "nurture_sms",
        contact_id: contactId,
        deal_id: dealId,
        payload: {
          content: render(s.template, vars),
          key: s.key,
          ...baseMsgPayload,
        },
        run_at: new Date(now + s.offsetMinutes * 60_000).toISOString(),
      });
    }
  }
  // WARM email drip - whenever we have an email (runs alongside SMS, or alone
  // for email-only opt-ins) and no email drip exists yet. Sent from the
  // closer's Gmail by dispatch_tasks. The day-3 bump carries thread_with so the
  // dispatcher replies INSIDE the opener's Gmail thread. Long-term email only
  // for email-only leads (phone leads get the SMS versions; both on the same
  // day reads like a blast).
  if (email && !emailExists) {
    const opener = language === "es" ? EMAIL_OPENER_ES : EMAIL_OPENER;
    const nurture = language === "es" ? EMAIL_NURTURE_ES : EMAIL_NURTURE;
    const longterm = e164
      ? []
      : language === "es"
        ? LONGTERM_EMAIL_ES
        : LONGTERM_EMAIL;
    const pushEmail = (s: EmailStep, taskType: string) =>
      rows.push({
        task_type: taskType,
        contact_id: contactId,
        deal_id: dealId,
        payload: {
          subject: render(s.subject, vars),
          content: render(s.body, vars),
          key: s.key,
          ...(s.threadWith ? { thread_with: s.threadWith } : {}),
          ...baseMsgPayload,
        },
        run_at: new Date(now + s.offsetMinutes * 60_000).toISOString(),
      });
    pushEmail(opener, "speed_to_lead_email");
    for (const s of [...nurture, ...longterm]) pushEmail(s, "nurture_email");
  }

  // Human double-dial cadence - needs a phone; independent of the messaging
  // dedupe so a lead who already got texts (but never calls) still gets dialed.
  let callSteps = 0;
  if (e164 && !callExists) {
    const callRows = buildCallCadenceRows({
      contactId,
      dealId,
      source,
      leadMagnet: magnet || undefined,
      now: new Date(now),
      tz,
    });
    callSteps = callRows.length;
    rows.push(...(callRows as unknown as Record<string, unknown>[]));
  }

  if (!rows.length)
    return { enqueued: 0, callSteps: 0, skipped: "nothing to enqueue" };

  // Narrow the concurrent-enrollment window: two simultaneous opt-ins (double
  // form submit, webhook retry) both pass the checks above; re-checking right
  // before the insert makes the loser of the race back off.
  if (e164 && !smsExists && (await hasRecentSmsCadence(identityIds))) {
    return { enqueued: 0, callSteps: 0, skipped: "concurrent enrollment" };
  }

  const r = await supabaseAdmin.from("scheduled_tasks").insert(rows);
  if (r.error) {
    console.error("[enrollment] enqueue failed", r.error);
    return { enqueued: 0, callSteps: 0, skipped: "insert failed" };
  }
  return { enqueued: rows.length, callSteps };
}

const ACTIVE_STAGES = [
  "lead",
  "contacted",
  "demo-booked",
  "demo-done",
  "proposal-sent",
  "in-negociation",
];

// Find the contact's open deal, or create one at stage 'lead' so the lead is
// visible on the kanban. Returns null only when the insert fails.
export async function ensureOpenDeal(opts: {
  contactId: number;
  name: string;
  source: string;
  companyId?: number | null;
}): Promise<number | null> {
  const { data: openDeal } = await supabaseAdmin
    .from("deals")
    .select("id")
    .contains("contact_ids", [opts.contactId])
    .in("stage", ACTIVE_STAGES)
    .limit(1);
  if (openDeal && openDeal[0]) return openDeal[0].id;
  const d = await supabaseAdmin
    .from("deals")
    .insert({
      name: opts.name,
      stage: "lead",
      category: opts.source,
      contact_ids: [opts.contactId],
      company_id: opts.companyId ?? null,
    })
    .select("id")
    .single();
  if (d.error) {
    console.error("[enrollment] deal insert failed", d.error);
    return null;
  }
  return d.data.id;
}

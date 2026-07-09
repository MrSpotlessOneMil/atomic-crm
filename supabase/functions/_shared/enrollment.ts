// Single place a warm lead gets put on the full drip: instant speed-to-lead
// SMS + email, the nurture sequences, and the human double-dial call cadence.
//
// Callers: lead_inbound (every opt-in POST), enroll_orphans (the safety-net
// sweep that catches leads inserted by ANY other path, e.g. the Zapier that
// writes Meta leads straight into contacts), and public_lead (quote form).
// Keeping enrollment here guarantees a lead can never be "in the CRM but not
// being worked" no matter which door they came through.

import { supabaseAdmin } from "./supabaseAdmin.ts";
import { OPENER, NURTURE, EMAIL_OPENER, EMAIL_NURTURE, render } from "./salesCopy.ts";
import { openerForSource, isColdSource } from "./leadPlaybooks.ts";
import { contactIdsByIdentity, hasRecentCadence, hasRecentCallCadence } from "./contactIdentity.ts";
import { buildCallCadenceRows } from "./callCadence.ts";

const envGet = (name: string): string | undefined =>
  (globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }).Deno?.env?.get?.(name);

const repName = () => envGet("SALES_AGENT_NAME") || "Robin";

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
}

export interface EnrollResult {
  enqueued: number;
  callSteps: number;
  skipped?: string; // reason when nothing was enqueued
}

export async function enrollLeadCadence(input: EnrollInput): Promise<EnrollResult> {
  const { contactId, dealId, source } = input;
  const e164 = input.e164 || null;
  const email = input.email || null;
  const magnet = input.magnet || "";

  // Cold sources (cold-call / cold-email) are worked by the outbound AUDIT
  // play, not the warm opt-in drip.
  if (isColdSource(source)) return { enqueued: 0, callSteps: 0, skipped: "cold source" };
  if (!e164 && !email) return { enqueued: 0, callSteps: 0, skipped: "no phone or email" };

  // Dedupe by IDENTITY (every contact sharing this phone/email), not just this
  // contact_id - so a duplicate contact can never double-text or double-dial.
  const identityIds = await contactIdsByIdentity(e164, email);
  if (!identityIds.includes(contactId)) identityIds.push(contactId);
  const messagingExists = await hasRecentCadence(identityIds);
  const callExists = e164 ? await hasRecentCallCadence(identityIds) : true;
  if (messagingExists && callExists) {
    console.warn("[enrollment] cadence already active for this identity - skipping", { contactId });
    return { enqueued: 0, callSteps: 0, skipped: "cadence already active" };
  }

  const { count: recentTasks } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("*", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((recentTasks ?? 0) > FLOOD_CAP_PER_HOUR) {
    console.warn("[enrollment] flood cap hit - skipping auto-cadence", { contactId, recentTasks });
    return { enqueued: 0, callSteps: 0, skipped: "flood cap" };
  }

  // We enqueue even while sends are paused: dispatch_tasks HOLDS the queue
  // during a pause, so tasks just wait and flush when sends resume. This
  // guarantees no lead is ever logged without a cadence.
  const vars = { rep_name: repName(), lead_magnet: magnet || "your free templates" };
  const now = Date.now();
  const rows: Record<string, unknown>[] = [];

  if (!messagingExists) {
    // SMS cadence - only when we have a phone. Opener voice is picked by source
    // (see leadPlaybooks.ts) so social/website/audit each open differently.
    if (e164) {
      rows.push({
        task_type: "speed_to_lead_sms",
        contact_id: contactId,
        deal_id: dealId,
        payload: { content: render(openerForSource(source, magnet) ?? OPENER, vars), key: "opener" },
        run_at: new Date(now).toISOString(),
      });
      for (const s of NURTURE) {
        rows.push({
          task_type: "nurture_sms",
          contact_id: contactId,
          deal_id: dealId,
          payload: { content: render(s.template, vars), key: s.key },
          run_at: new Date(now + s.offsetMinutes * 60_000).toISOString(),
        });
      }
    }
    // WARM email drip - whenever we have an email (runs alongside SMS, or alone
    // for email-only opt-ins). Sent from the closer's Gmail by dispatch_tasks.
    if (email) {
      rows.push({
        task_type: "speed_to_lead_email",
        contact_id: contactId,
        deal_id: dealId,
        payload: { subject: EMAIL_OPENER.subject, content: render(EMAIL_OPENER.body, vars), key: EMAIL_OPENER.key },
        run_at: new Date(now + EMAIL_OPENER.offsetMinutes * 60_000).toISOString(),
      });
      for (const s of EMAIL_NURTURE) {
        rows.push({
          task_type: "nurture_email",
          contact_id: contactId,
          deal_id: dealId,
          payload: { subject: s.subject, content: render(s.body, vars), key: s.key },
          run_at: new Date(now + s.offsetMinutes * 60_000).toISOString(),
        });
      }
    }
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
      tz: envGet("QUIET_HOURS_TZ") || undefined,
    });
    callSteps = callRows.length;
    rows.push(...(callRows as unknown as Record<string, unknown>[]));
  }

  if (!rows.length) return { enqueued: 0, callSteps: 0, skipped: "nothing to enqueue" };
  const r = await supabaseAdmin.from("scheduled_tasks").insert(rows);
  if (r.error) {
    console.error("[enrollment] enqueue failed", r.error);
    return { enqueued: 0, callSteps: 0, skipped: "insert failed" };
  }
  return { enqueued: rows.length, callSteps };
}

const ACTIVE_STAGES = ["lead", "contacted", "demo-booked", "demo-done", "proposal-sent", "in-negociation"];

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

// The single kill switch for automated follow-up. THE rule (owner mandate):
// the moment a lead responds on ANY channel - SMS reply, email reply, or a real
// phone conversation - every automated touch stops. No more nurture texts, no
// more drip emails, no more CALL NOW queue items. A human (or the AI agent, on
// SMS) owns the conversation from that point.
//
// Identity-wide by design: cancellation targets every contact row sharing the
// lead's phone or email, so a duplicate contact created by a webhook race or a
// legacy phone-format mismatch can never keep a drip alive. Phone matching
// tries every format variant (E.164, bare digits, digits-without-country) to
// cover rows written before the E.164 backfill.
//
// Callers: quo_inbound (SMS reply / STOP), inbound_lead_reply (email reply via
// Postmark), gmail_reply_scan (email reply into the closer's Gmail),
// quo_call_events (a real phone conversation), book_slot + calendly_webhook
// (booked = chase over).

import { supabaseAdmin } from "./supabaseAdmin.ts";
import { toE164 } from "./quoSales.ts";
import { closeOpenCallTasks } from "./callTasks.ts";

// Top-of-funnel chase task types. Kept canonical HERE; dispatch_tasks imports
// this list so the send-time guard and the reply-cancel can never drift apart.
export const CHASE_TASK_TYPES = [
  "speed_to_lead_sms",
  "nurture_sms",
  "sdr_call_drip_sms",
  "agent_followup",
  "speed_to_lead_email",
  "nurture_email",
  "call_task",
];

// Everything the queue can hold, chase or not. Used for STOP (a lead who opts
// out gets NOTHING further, reminders included).
const ALL_TASK_TYPES = [...CHASE_TASK_TYPES, "reminder_sms", "no_show_check"];

// Every way this phone may be stored in contacts.phone_jsonb: E.164, raw
// digits, digits without the leading country code. Pre-backfill rows (e.g. the
// lead-magnet crm-sync wrote bare digits) still match.
export function phoneVariants(raw?: string | null): string[] {
  const out = new Set<string>();
  const e164 = toE164(raw);
  if (e164) {
    out.add(e164);
    const digits = e164.replace(/\D/g, "");
    out.add(digits);
    if (digits.length === 11 && digits.startsWith("1"))
      out.add(digits.slice(1));
  }
  const trimmed = (raw ?? "").trim();
  if (trimmed) out.add(trimmed);
  return [...out];
}

function emailsOf(jsonb: unknown): string[] {
  if (!Array.isArray(jsonb)) return [];
  const out: string[] = [];
  for (const e of jsonb) {
    const v =
      e && typeof e === "object" ? (e as Record<string, unknown>).email : e;
    if (typeof v === "string" && v.includes("@"))
      out.push(v.trim().toLowerCase());
  }
  return [...new Set(out)];
}

function phonesOf(jsonb: unknown): string[] {
  if (!Array.isArray(jsonb)) return [];
  const out: string[] = [];
  for (const e of jsonb) {
    const v =
      e && typeof e === "object" ? (e as Record<string, unknown>).number : e;
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return [...new Set(out)];
}

// This contact + every duplicate sharing any phone variant or email.
export async function identityContactIds(contactId: number): Promise<number[]> {
  const ids = new Set<number>([contactId]);
  try {
    const { data: c } = await supabaseAdmin
      .from("contacts")
      .select("email_jsonb, phone_jsonb")
      .eq("id", contactId)
      .maybeSingle();
    for (const phone of phonesOf(c?.phone_jsonb)) {
      for (const variant of phoneVariants(phone)) {
        const { data } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .contains("phone_jsonb", [{ number: variant }]);
        (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
      }
    }
    for (const email of emailsOf(c?.email_jsonb)) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .contains("email_jsonb", [{ email }]);
      (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
    }
  } catch (e) {
    console.error("[haltFollowup] identity resolution failed", e);
  }
  return [...ids];
}

export interface HaltResult {
  contactIds: number[];
  cancelled: number;
}

// Cancel automated follow-up for this lead, identity-wide.
//   scope "chase" (default): nurture/drip/call chase only - a booked lead's
//     demo reminders keep flowing.
//   scope "all": reminders + no-show checks too (STOP / hard opt-out).
export async function haltFollowup(opts: {
  contactId: number;
  reason: string; // "sms_reply" | "email_reply" | "call_conversation" | "stop" | "booked" | ...
  scope?: "chase" | "all";
  note?: string; // optional contact_note for the human timeline
}): Promise<HaltResult> {
  const ids = await identityContactIds(opts.contactId);
  const types = opts.scope === "all" ? ALL_TASK_TYPES : CHASE_TASK_TYPES;

  let cancelled = 0;
  try {
    const { data } = await supabaseAdmin
      .from("scheduled_tasks")
      .update({
        status: "canceled",
        last_error: `halted: ${opts.reason}`,
        updated_at: new Date().toISOString(),
      })
      .in("contact_id", ids)
      .eq("status", "pending")
      .in("task_type", types)
      .select("id");
    cancelled = data?.length ?? 0;
  } catch (e) {
    console.error("[haltFollowup] cancel failed", e);
  }

  // Nobody keeps dialing a lead who responded: clear bridged CALL NOW items.
  for (const id of ids) await closeOpenCallTasks(id);

  if (opts.note) {
    try {
      await supabaseAdmin.from("contact_notes").insert({
        contact_id: opts.contactId,
        text: opts.note,
        date: new Date().toISOString(),
        status: "warm",
      });
    } catch (_e) {
      /* visibility only */
    }
  }

  return { contactIds: ids, cancelled };
}

// "The lead responded" notification - the human 5-minute-SLA hook. Targets the
// assigned rep, else every active admin (same fan-out as call_due/handoff).
export async function notifyLeadReplied(opts: {
  contactId: number;
  channel: "sms" | "email" | "call";
  preview?: string;
}): Promise<void> {
  try {
    const { data: c } = await supabaseAdmin
      .from("contacts")
      .select("sales_id")
      .eq("id", opts.contactId)
      .maybeSingle();
    let targets: number[] = [];
    if (c?.sales_id) {
      // A lead assigned to a deactivated rep must still ping SOMEBODY.
      const { data: rep } = await supabaseAdmin
        .from("sales")
        .select("id, disabled")
        .eq("id", c.sales_id)
        .maybeSingle();
      if (rep && !rep.disabled) targets = [rep.id as number];
    }
    if (!targets.length) {
      const { data: admins } = await supabaseAdmin
        .from("sales")
        .select("id")
        .eq("administrator", true)
        .eq("disabled", false);
      targets = (admins ?? []).map((a: { id: number }) => a.id);
    }
    for (const sid of targets) {
      const { error } = await supabaseAdmin.from("notifications").insert({
        sales_id: sid,
        type: "lead_replied",
        payload: {
          contact_id: opts.contactId,
          channel: opts.channel,
          preview: (opts.preview ?? "").slice(0, 200),
        },
      });
      // Loud on failure: a silently-dropped ping breaks the 5-minute SLA (e.g.
      // functions deployed before the notifications_type_check migration).
      if (error)
        console.error("[haltFollowup] lead_replied insert FAILED", error);
    }
  } catch (e) {
    console.error("[haltFollowup] notifyLeadReplied failed", e);
  }
}

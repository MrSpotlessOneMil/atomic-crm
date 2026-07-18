// Identity-based dedup helpers. The point: guarantee we NEVER start a second
// messaging cadence for the same person, even when a duplicate contact slips
// through intake (e.g. two website opt-ins seconds/minutes apart, or a phone
// lookup that races). Everything keys off shared phone/email, not contact_id.

import { supabaseAdmin } from "./supabaseAdmin.ts";
import { phoneVariants } from "./haltFollowup.ts";

// Every contact row that shares this phone or email (the "same person").
// Phone matching tries every stored format (E.164 / bare digits) so rows
// written before the E.164 backfill still count as the same identity.
export async function contactIdsByIdentity(
  phone?: string | null,
  email?: string | null,
): Promise<number[]> {
  const ids = new Set<number>();
  if (phone) {
    for (const variant of phoneVariants(phone)) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .contains("phone_jsonb", [{ number: variant }]);
      (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
    }
  }
  if (email) {
    const e = email.trim().toLowerCase();
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .contains("email_jsonb", [{ email: e }]);
    (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
  }
  return [...ids];
}

const CADENCE_TASK_TYPES = [
  "speed_to_lead_sms",
  "nurture_sms",
  "speed_to_lead_email",
  "nurture_email",
];

const SMS_CADENCE_TYPES = ["speed_to_lead_sms", "nurture_sms"];
const EMAIL_CADENCE_TYPES = ["speed_to_lead_email", "nurture_email"];

async function hasCadenceOfTypes(
  contactIds: number[],
  types: string[],
  windowDays: number,
): Promise<boolean> {
  if (!contactIds.length) return false;
  const since = new Date(Date.now() - windowDays * 24 * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("id")
    .in("contact_id", contactIds)
    .in("task_type", types)
    .gte("created_at", since)
    .limit(1);
  return !!(data && data.length);
}

// True if a messaging cadence was already enqueued for ANY of these contacts
// within the window. Default 365 days = effectively "ever": the drip now spans
// 90 days (long-term nurture) and the enroll_orphans sweep looks back 30 days,
// so a shorter window would RE-enroll every silent lead once their first drip
// aged out of it (the day-15 re-drip bug). Deliberate re-engagement lives in
// the long-term nurture steps, never in re-enrollment.
export async function hasRecentCadence(
  contactIds: number[],
  windowDays = 365,
): Promise<boolean> {
  return hasCadenceOfTypes(contactIds, CADENCE_TASK_TYPES, windowDays);
}

// Per-CHANNEL checks — the common partial-then-full flow (email-only opt-in,
// phone arrives on the later full submit) must still start the SMS drip even
// though the email drip already exists. One combined bucket silently dropped
// every text for that flow.
export async function hasRecentSmsCadence(
  contactIds: number[],
  windowDays = 365,
): Promise<boolean> {
  return hasCadenceOfTypes(contactIds, SMS_CADENCE_TYPES, windowDays);
}

export async function hasRecentEmailCadence(
  contactIds: number[],
  windowDays = 365,
): Promise<boolean> {
  return hasCadenceOfTypes(contactIds, EMAIL_CADENCE_TYPES, windowDays);
}

// Same identity-wide dedupe for the human double-dial cadence (task_type
// 'call_task'). Kept SEPARATE from CADENCE_TASK_TYPES so messaging dedupe
// semantics don't change: a lead who already got texts but never got calls can
// still be enrolled in calls (and vice versa).
export async function hasRecentCallCadence(
  contactIds: number[],
  windowDays = 365,
): Promise<boolean> {
  if (!contactIds.length) return false;
  const since = new Date(Date.now() - windowDays * 24 * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("id")
    .in("contact_id", contactIds)
    .eq("task_type", "call_task")
    .gte("created_at", since)
    .limit(1);
  return !!(data && data.length);
}

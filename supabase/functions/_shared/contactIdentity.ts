// Identity-based dedup helpers. The point: guarantee we NEVER start a second
// messaging cadence for the same person, even when a duplicate contact slips
// through intake (e.g. two website opt-ins seconds/minutes apart, or a phone
// lookup that races). Everything keys off shared phone/email, not contact_id.

import { supabaseAdmin } from "./supabaseAdmin.ts";

// Every contact row that shares this phone or email (the "same person").
export async function contactIdsByIdentity(
  phone?: string | null,
  email?: string | null,
): Promise<number[]> {
  const ids = new Set<number>();
  if (phone) {
    const { data } = await supabaseAdmin
      .from("contacts").select("id").contains("phone_jsonb", [{ number: phone }]);
    (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
  }
  if (email) {
    const e = email.trim().toLowerCase();
    const { data } = await supabaseAdmin
      .from("contacts").select("id").contains("email_jsonb", [{ email: e }]);
    (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
  }
  return [...ids];
}

const CADENCE_TASK_TYPES = ["speed_to_lead_sms", "nurture_sms", "speed_to_lead_email", "nurture_email"];

// True if a messaging cadence was already enqueued for ANY of these contacts
// within the window (default 14 days = the full nurture span). If so, starting
// another would double-text the person, so the caller must skip enqueuing.
export async function hasRecentCadence(contactIds: number[], windowDays = 14): Promise<boolean> {
  if (!contactIds.length) return false;
  const since = new Date(Date.now() - windowDays * 24 * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("id")
    .in("contact_id", contactIds)
    .in("task_type", CADENCE_TASK_TYPES)
    .gte("created_at", since)
    .limit(1);
  return !!(data && data.length);
}

// Same identity-wide dedupe for the human double-dial cadence (task_type
// 'call_task'). Kept SEPARATE from CADENCE_TASK_TYPES so messaging dedupe
// semantics don't change: a lead who already got texts but never got calls can
// still be enrolled in calls (and vice versa).
export async function hasRecentCallCadence(contactIds: number[], windowDays = 14): Promise<boolean> {
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

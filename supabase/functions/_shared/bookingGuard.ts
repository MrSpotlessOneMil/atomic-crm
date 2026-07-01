// Single source of truth for "has this person already booked a demo?" — used by
// the task dispatcher to STOP chase messages (nurture / drip / followups) once a
// lead is booked. Crucially it matches by IDENTITY (shared email or phone), so
// it still fires when the booking landed on a DUPLICATE contact — e.g. the SMS
// lead is keyed by phone (contact A) but Calendly matched them by email and
// booked under contact B. Reminders + no-show checks are NOT chase and keep
// flowing through their own task types.

import { supabaseAdmin } from "./supabaseAdmin.ts";

// A deal at or past these stages means the lead is booked / in the closer's
// hands — they should not be receiving top-of-funnel chase texts.
const BOOKED_STAGES = ["demo-booked", "demo-done", "proposal-sent", "in-negociation", "won"];

function emailsOf(jsonb: unknown): string[] {
  if (!Array.isArray(jsonb)) return [];
  const out: string[] = [];
  for (const e of jsonb) {
    const v = e && typeof e === "object" ? (e as Record<string, unknown>).email : e;
    if (typeof v === "string" && v.includes("@")) out.push(v.trim().toLowerCase());
  }
  return [...new Set(out)];
}

function phonesOf(jsonb: unknown): string[] {
  if (!Array.isArray(jsonb)) return [];
  const out: string[] = [];
  for (const e of jsonb) {
    const v = e && typeof e === "object" ? (e as Record<string, unknown>).number : e;
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return [...new Set(out)];
}

// True if this contact — OR any duplicate sharing its email/phone — has a
// demo-booked+ deal or a future scheduled booking. Best-effort: on any error it
// returns false (fail-open) so a flaky read never silently blocks the queue.
export async function hasBookedDemo(contactId: number): Promise<boolean> {
  try {
    const { data: c } = await supabaseAdmin
      .from("contacts")
      .select("email_jsonb, phone_jsonb")
      .eq("id", contactId)
      .maybeSingle();

    // Collect this contact + every duplicate that shares an email or phone.
    const ids = new Set<number>([contactId]);
    for (const email of emailsOf(c?.email_jsonb)) {
      const { data } = await supabaseAdmin
        .from("contacts").select("id").contains("email_jsonb", [{ email }]);
      (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
    }
    for (const number of phonesOf(c?.phone_jsonb)) {
      const { data } = await supabaseAdmin
        .from("contacts").select("id").contains("phone_jsonb", [{ number }]);
      (data ?? []).forEach((r: { id: number }) => ids.add(r.id));
    }
    const idList = [...ids];

    // A booked-or-later deal on any of those contacts?
    const { data: deals } = await supabaseAdmin
      .from("deals").select("id").overlaps("contact_ids", idList).in("stage", BOOKED_STAGES).limit(1);
    if (deals && deals.length) return true;

    // A future scheduled booking on any of those contacts?
    const { data: bk } = await supabaseAdmin
      .from("bookings").select("id").in("contact_id", idList)
      .eq("status", "scheduled").gt("scheduled_for", new Date().toISOString()).limit(1);
    return !!(bk && bk.length);
  } catch (e) {
    console.error("[bookingGuard] hasBookedDemo threw", e);
    return false;
  }
}

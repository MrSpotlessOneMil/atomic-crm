// Shared helper: mirror a booked demo into the `bookings` table so it shows on
// the rep's /bookings page + weekly digest, and feeds availability / no-double-
// book. Demos booked via Calendly (calendly_webhook) and the Google Calendar
// poller (gcal_poll) both flow through here; the self-serve widget (book_slot)
// writes its own row directly. Bookings are owned by the human closer
// (CLOSER_SALES_ID), matching the "AI books, humans close" handoff.

import { supabaseAdmin } from "./supabaseAdmin.ts";

async function closerSalesId(): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "CLOSER_SALES_ID")
    .single();
  const id = data?.value ? Number(data.value) : 4; // default closer
  return Number.isFinite(id) ? id : null;
}

// Record a booked demo. Idempotent (re-poll / duplicate webhook safe) and
// best-effort — never throws, so it can't break the calling webhook.
export async function recordBooking(opts: {
  contactId: number;
  scheduledFor: string; // ISO timestamp
  durationMinutes?: number;
  notes?: string;
}): Promise<void> {
  try {
    const salesId = await closerSalesId();
    if (!salesId) return; // can't satisfy NOT NULL sales_id; skip rather than throw

    const scheduledIso = new Date(opts.scheduledFor).toISOString();

    // Dedupe: don't double-write the same demo on re-poll / duplicate webhook.
    const { data: existing } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("contact_id", opts.contactId)
      .eq("scheduled_for", scheduledIso)
      .in("status", ["scheduled", "completed"])
      .limit(1);
    if (existing && existing.length) return;

    const { error } = await supabaseAdmin.from("bookings").insert({
      sales_id: salesId,
      contact_id: opts.contactId,
      scheduled_for: scheduledIso,
      duration_minutes: opts.durationMinutes ?? 30,
      notes: opts.notes ?? null,
      status: "scheduled",
    });
    if (error) {
      console.error("[bookings] insert failed", error);
      return;
    }

    // Surface it to the closer (notification type already exists in schema).
    await supabaseAdmin.from("notifications").insert({
      sales_id: salesId,
      type: "booking_created",
      payload: { contact_id: opts.contactId, scheduled_for: scheduledIso },
    });
  } catch (e) {
    console.error("[bookings] recordBooking threw", e);
  }
}

// Cancel a contact's scheduled booking(s). Best-effort.
export async function cancelBooking(opts: {
  contactId: number;
  scheduledFor?: string;
}): Promise<void> {
  try {
    let q = supabaseAdmin
      .from("bookings")
      .update({ status: "canceled" })
      .eq("contact_id", opts.contactId)
      .eq("status", "scheduled");
    if (opts.scheduledFor) {
      q = q.eq("scheduled_for", new Date(opts.scheduledFor).toISOString());
    }
    const { error } = await q;
    if (error) console.error("[bookings] cancel failed", error);
  } catch (e) {
    console.error("[bookings] cancelBooking threw", e);
  }
}

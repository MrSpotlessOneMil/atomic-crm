// Public booking endpoint. Prospects can book a time slot with a specific rep
// without an account. Validates the slot against the rep's published
// availability and prevents double-booking. Creates a contact under the rep
// (or reuses an existing one keyed by email) and writes the booking row.
//
// Path: POST /functions/v1/book_slot

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

type RequestBody = {
  sales_id?: number | string;
  scheduled_for?: string; // ISO timestamp
  duration_minutes?: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  /** Honeypot — bots fill this. */
  website?: string;
};

const trim = (s: unknown, max = 200): string =>
  typeof s === "string" ? s.trim().slice(0, max) : "";

const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// HH:MM:SS for comparison with the time columns in rep_availability.
const toClockString = (d: Date): string => {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const handle = async (req: Request) => {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  if (typeof body.website === "string" && body.website.trim().length > 0) {
    // Honeypot hit — silently accept.
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const salesId = Number(body.sales_id);
  if (!Number.isFinite(salesId) || salesId <= 0) {
    return createErrorResponse(400, "sales_id is required");
  }
  const scheduledFor = trim(body.scheduled_for, 64);
  if (!scheduledFor) {
    return createErrorResponse(400, "scheduled_for is required");
  }
  const scheduled = new Date(scheduledFor);
  if (Number.isNaN(scheduled.getTime())) {
    return createErrorResponse(400, "Invalid scheduled_for");
  }
  if (scheduled.getTime() < Date.now()) {
    return createErrorResponse(400, "Cannot book a slot in the past");
  }

  const duration = Math.min(
    Math.max(Number(body.duration_minutes) || 30, 15),
    240,
  );

  const firstName = trim(body.first_name, 80);
  const lastName = trim(body.last_name, 80);
  const email = trim(body.email, 200).toLowerCase();
  const phone = trim(body.phone, 40);
  const notes = trim(body.notes, 2000);
  if (!firstName || !lastName || !email) {
    return createErrorResponse(
      400,
      "first_name, last_name, and email are required",
    );
  }
  if (!isEmail(email)) {
    return createErrorResponse(400, "Invalid email");
  }

  // Verify the rep exists and is active.
  const { data: sale, error: saleError } = await supabaseAdmin
    .from("sales")
    .select("id, disabled")
    .eq("id", salesId)
    .single();
  if (saleError || !sale || sale.disabled) {
    return createErrorResponse(404, "Rep not available");
  }

  // Check the requested slot lies within published availability.
  const dow = scheduled.getUTCDay();
  const clock = toClockString(scheduled);
  const { data: windows } = await supabaseAdmin
    .from("rep_availability")
    .select("start_time, end_time")
    .eq("sales_id", salesId)
    .eq("day_of_week", dow);
  const fits = (windows ?? []).some(
    (w) => clock >= w.start_time && clock < w.end_time,
  );
  if (!fits) {
    return createErrorResponse(409, "Time outside availability");
  }

  // Conflict check: any other scheduled booking that overlaps with this one.
  const startIso = scheduled.toISOString();
  const endIso = new Date(scheduled.getTime() + duration * 60_000).toISOString();
  const { data: conflicts } = await supabaseAdmin
    .from("bookings")
    .select("id, scheduled_for, duration_minutes, status")
    .eq("sales_id", salesId)
    .eq("status", "scheduled")
    .gte("scheduled_for", new Date(scheduled.getTime() - 4 * 60 * 60_000).toISOString())
    .lte("scheduled_for", endIso);
  const hasConflict = (conflicts ?? []).some((b) => {
    const bStart = new Date(b.scheduled_for).getTime();
    const bEnd = bStart + (b.duration_minutes ?? 30) * 60_000;
    return bStart < new Date(endIso).getTime() && bEnd > new Date(startIso).getTime();
  });
  if (hasConflict) {
    return createErrorResponse(409, "Slot already booked");
  }

  // Find or create the contact under this rep keyed by email.
  let contactId: number | null = null;
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("sales_id", salesId)
    .contains("email_jsonb", [{ email }])
    .limit(1);
  if (existing && existing.length > 0) {
    contactId = existing[0].id as number;
  } else {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email_jsonb: [{ email, type: "Work" }],
        phone_jsonb: phone ? [{ number: phone, type: "Work" }] : null,
        background: [
          notes ? `Booking notes: ${notes}` : "",
          `Source: /u/${salesId} booking widget`,
        ]
          .filter(Boolean)
          .join("\n"),
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        sales_id: salesId,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("book_slot: contact insert failed", insertErr);
      return createErrorResponse(500, "Failed to create contact");
    }
    contactId = inserted.id as number;
  }

  // Create the booking.
  const { data: booking, error: bookingErr } = await supabaseAdmin
    .from("bookings")
    .insert({
      sales_id: salesId,
      contact_id: contactId,
      scheduled_for: scheduled.toISOString(),
      duration_minutes: duration,
      notes,
      status: "scheduled",
    })
    .select("id, scheduled_for, duration_minutes")
    .single();
  if (bookingErr || !booking) {
    console.error("book_slot: booking insert failed", bookingErr);
    return createErrorResponse(500, "Failed to create booking");
  }

  return new Response(
    JSON.stringify({
      ok: true,
      booking_id: booking.id,
      scheduled_for: booking.scheduled_for,
      duration_minutes: booking.duration_minutes,
    }),
    {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

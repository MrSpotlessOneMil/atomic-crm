// calendly_webhook — keeps the CRM in sync with the Calendly demo calendar and
// drives the reminder / no-show engine.
//
//   invitee.created  -> deal stage 'demo-booked', cancel nurture, schedule the
//                       reminder cadence (24h / morning / 1h) + a no-show check.
//   invitee.canceled -> deal stage back to 'contacted', cancel reminders, send
//                       one rebook nudge.
//
// Auth: Calendly-Webhook-Signature (t=<ts>,v1=<hex-hmac-sha256 of `t.rawBody`>),
// keyed by CALENDLY_WEBHOOK_SIGNING_KEY.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { toE164, salesSendsPaused } from "../_shared/quoSales.ts";
import { assignToCloser } from "../_shared/handoff.ts";
import { recordBooking, cancelBooking } from "../_shared/bookings.ts";
import { scheduleDemoReminders } from "../_shared/demoReminders.ts";

const ACTIVE_STAGES = [
  "lead",
  "contacted",
  "demo-booked",
  "demo-done",
  "proposal-sent",
  "in-negociation",
];
const repName = () => Deno.env.get("SALES_AGENT_NAME") || "Robin";
const tz = () => Deno.env.get("QUIET_HOURS_TZ") || "America/New_York";

const ok = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    k,
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verify(
  raw: string,
  header: string | null,
  key: string,
): Promise<boolean> {
  if (!header) return false;
  const fields = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = fields["t"];
  const v1 = fields["v1"];
  if (!t || !v1) return false;
  const expected = await hmacHex(key, `${t}.${raw}`);
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

function fmtDemoTime(startIso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz(),
    }).format(new Date(startIso));
  } catch {
    return startIso;
  }
}

async function findContact(
  email: string,
  phone: string,
): Promise<number | null> {
  if (email) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .contains("email_jsonb", [{ email }])
      .limit(1);
    if (data && data[0]) return data[0].id;
  }
  if (phone) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .contains("phone_jsonb", [{ number: phone }])
      .limit(1);
    if (data && data[0]) return data[0].id;
  }
  return null;
}

async function openDeal(contactId: number): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("deals")
    .select("id")
    .contains("contact_ids", [contactId])
    .in("stage", ACTIVE_STAGES)
    .limit(1);
  return (data && data[0]?.id) ?? null;
}

const handle = async (req: Request) => {
  if (req.method !== "POST")
    return createErrorResponse(405, "Method Not Allowed");

  const key = Deno.env.get("CALENDLY_WEBHOOK_SIGNING_KEY");
  if (!key) return createErrorResponse(503, "Calendly webhook not configured");

  const raw = await req.text();
  if (
    !(await verify(raw, req.headers.get("Calendly-Webhook-Signature"), key))
  ) {
    return createErrorResponse(401, "Bad signature");
  }

  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  const kind = evt?.event;
  if (kind !== "invitee.created" && kind !== "invitee.canceled") return ok();

  // Global pause: keep the CRM in sync (stage moves, handoff, notes) but queue
  // NO outbound texts (reminders, no-show recovery, rebook nudge).
  const paused = await salesSendsPaused();

  const p = evt?.payload ?? {};
  const email = String(p.email ?? "")
    .toLowerCase()
    .trim();
  const phone = toE164(
    String(p.text_reminder_number ?? p.sms_reminder_number ?? ""),
  );
  const name = String(p.name ?? "").trim();
  const start = p.scheduled_event?.start_time ?? p.event?.start_time ?? null;
  const end = p.scheduled_event?.end_time ?? null;
  const joinLink = p.scheduled_event?.location?.join_url ?? "";

  // Locate (or, for a direct booking, create) the contact.
  let contactId = await findContact(email, phone);
  if (!contactId) {
    if (kind === "invitee.canceled") return ok(); // nothing to cancel
    const parts = name.split(" ");
    const ins = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: parts[0] || "there",
        last_name: parts.slice(1).join(" "),
        email_jsonb: email ? [{ email, type: "Work" }] : null,
        phone_jsonb: phone ? [{ number: phone, type: "Mobile" }] : null,
        lead_source: "inbound",
        background: "Booked a demo directly via Calendly.",
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ins.error) {
      console.error("[calendly_webhook] contact insert failed", ins.error);
      return ok();
    }
    contactId = ins.data.id;
  }

  // Reminders + no-show recovery are SMS-only. Skip queuing them for a contact
  // with no phone on file (an email-only booking) - otherwise they just fail in
  // dispatch with "no phone for task".
  let hasPhone = !!phone;
  if (!hasPhone) {
    const { data: c } = await supabaseAdmin
      .from("contacts")
      .select("phone_jsonb")
      .eq("id", contactId)
      .maybeSingle();
    const pj = c?.phone_jsonb;
    hasPhone =
      Array.isArray(pj) &&
      pj.some(
        (e: any) =>
          (typeof e === "string" && e.trim()) ||
          (e &&
            typeof e === "object" &&
            typeof e.number === "string" &&
            e.number.trim()),
      );
  }

  let dealId = await openDeal(contactId);
  if (!dealId && kind === "invitee.created") {
    const d = await supabaseAdmin
      .from("deals")
      .insert({
        name: name || `Demo ${email || phone}`,
        stage: "lead",
        category: "inbound",
        contact_ids: [contactId],
      })
      .select("id")
      .single();
    if (!d.error) dealId = d.data.id;
  }

  if (kind === "invitee.canceled") {
    if (dealId) {
      await supabaseAdmin
        .from("deals")
        .update({ stage: "contacted", updated_at: new Date().toISOString() })
        .eq("id", dealId);
    }
    // Drop pending reminders + no-show check for this contact.
    await supabaseAdmin
      .from("scheduled_tasks")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("contact_id", contactId)
      .eq("status", "pending")
      .in("task_type", ["reminder_sms", "no_show_check"]);
    // Walk back the bookings row too (rep /bookings + weekly digest).
    if (contactId) await cancelBooking({ contactId });
    // One gentle rebook nudge in ~2h (SMS-only; skipped while sends paused or no phone).
    if (!paused && hasPhone) {
      const calendly =
        (
          await supabaseAdmin
            .from("integration_secrets")
            .select("value")
            .eq("key", "CALENDLY_BOOKING_URL")
            .single()
        ).data?.value ??
        "https://calendly.com/dominic-theosirisai/cleaning-gameplan";
      await supabaseAdmin.from("scheduled_tasks").insert({
        task_type: "nurture_sms",
        contact_id: contactId,
        deal_id: dealId,
        payload: {
          content: `no worries {{first_name}}, want to grab another time for the robin line demo? ${calendly}`,
          key: "rebook",
        },
        run_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      });
    }
    await supabaseAdmin.from("contact_notes").insert({
      contact_id: contactId,
      text: "📅 Demo canceled via Calendly — moved back to contacted, rebook nudge queued.",
      date: new Date().toISOString(),
      status: "warm",
    });
    return ok();
  }

  // invitee.created
  if (!start) return ok();
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : startMs + 30 * 60_000;

  if (dealId) {
    await supabaseAdmin
      .from("deals")
      .update({
        stage: "demo-booked",
        next_action: `Demo ${fmtDemoTime(start)}`.slice(0, 200),
        next_action_date: new Date(startMs).toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("id", dealId);
    // Hand the booked demo to the closer (they run it + earn the commission).
    await assignToCloser({
      dealId,
      contactId,
      reason: "demo_booked",
      summary: `Demo booked for ${fmtDemoTime(start)}`,
    });
  }

  // Mirror the booked demo into the bookings table (rep /bookings + weekly
  // digest + availability). Owned by the closer; idempotent + best-effort.
  if (contactId) {
    await recordBooking({
      contactId,
      scheduledFor: start,
      durationMinutes: Math.max(15, Math.round((endMs - startMs) / 60_000)),
      notes: `Demo booked via Calendly${name ? " - " + name : ""}`,
    });
  }

  // Replace any prior funnel tasks (nurture + stale reminders) with a fresh set.
  await supabaseAdmin
    .from("scheduled_tasks")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("contact_id", contactId)
    .eq("status", "pending");

  // Full show-rate stack (instant confirmation, 24h/12h/3h/1h reminders,
  // no-show check, pull-forward call for far-out bookings, night-before rep
  // prompt) — shared with every other booking path via demoReminders.ts.
  // Enqueued even while sends are paused (the dispatcher HOLDS the queue and
  // flushes on resume); skipped only when the contact has no phone. The
  // invitee's own Calendly timezone wins so times read in THEIR clock.
  if (hasPhone) {
    await scheduleDemoReminders({
      contactId,
      dealId,
      startISO: start,
      durationMinutes: Math.max(15, Math.round((endMs - startMs) / 60_000)),
      joinUrl: joinLink || null,
      timeZone:
        typeof p.timezone === "string" && p.timezone ? p.timezone : undefined,
    });
  }

  await supabaseAdmin.from("contact_notes").insert({
    contact_id: contactId,
    text: paused
      ? `📅 Demo booked via Calendly for ${fmtDemoTime(start)} — logged to pipeline (auto-texts paused).`
      : hasPhone
        ? `📅 Demo booked via Calendly for ${fmtDemoTime(start)} — reminders + no-show check scheduled.`
        : `📅 Demo booked via Calendly for ${fmtDemoTime(start)} — no phone on file, SMS reminders skipped.`,
    date: new Date().toISOString(),
    status: "hot",
  });

  return ok();
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

// gcal_poll — logs demos booked on a dedicated Google Calendar into the CRM.
//
// Polls one calendar (GCAL_CALENDAR_ID) on a schedule (pg_cron, like
// dispatch_tasks). Each NEW confirmed event with a guest becomes / advances a
// pipeline deal to 'demo-booked' and is handed to the closer — mirroring
// calendly_webhook, but for demos booked straight on the calendar. Sends NO
// texts; this is pure CRM logging (so it runs even while SALES_SENDS_PAUSED).
//
// Auth: X-DISPATCH-TOKEN == DISPATCH_TASKS_TOKEN (same token the cron uses).
//
// Idempotency without a ledger table: one open deal per contact + a stage
// guard. We only advance a deal that's at 'lead'/'contacted'; a deal already at
// 'demo-booked' or beyond is left untouched (no duplicate note, no regression).
// Incremental syncToken means a given event is normally only seen again when it
// actually changes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { getGoogleAccessToken } from "../_shared/googleToken.ts";
import { assignToCloser } from "../_shared/handoff.ts";
import { recordBooking, cancelBooking } from "../_shared/bookings.ts";

const ACTIVE_STAGES = ["lead", "contacted", "demo-booked", "demo-done", "proposal-sent", "in-negociation"];
const ADVANCEABLE = ["lead", "contacted"]; // only these get pulled to demo-booked
const tz = () => Deno.env.get("QUIET_HOURS_TZ") || "America/New_York";

async function secret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("integration_secrets").select("value").eq("key", key).single();
  return data?.value ?? null;
}

async function setSecret(key: string, value: string): Promise<void> {
  await supabaseAdmin
    .from("integration_secrets")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

function fmtDemoTime(startIso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz(),
    }).format(new Date(startIso));
  } catch {
    return startIso;
  }
}

interface GCalEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  start?: { dateTime?: string; date?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }>;
}

// The prospect = first attendee who isn't us and isn't a room/resource.
function pickGuest(ev: GCalEvent): { email: string; name: string } | null {
  const organizer = (ev.organizer?.email ?? "").toLowerCase();
  for (const a of ev.attendees ?? []) {
    const email = (a.email ?? "").toLowerCase().trim();
    if (!email || a.self || a.resource) continue;
    if (email === organizer) continue;
    if (a.responseStatus === "declined") continue;
    return { email, name: (a.displayName ?? "").trim() };
  }
  return null;
}

async function findContactByEmail(email: string): Promise<number | null> {
  const { data } = await supabaseAdmin.from("contacts").select("id").contains("email_jsonb", [{ email }]).limit(1);
  return (data && data[0]?.id) ?? null;
}

async function openDeal(contactId: number): Promise<{ id: number; stage: string } | null> {
  const { data } = await supabaseAdmin
    .from("deals")
    .select("id, stage")
    .contains("contact_ids", [contactId])
    .in("stage", ACTIVE_STAGES)
    .limit(1);
  return (data && data[0]) ?? null;
}

type EventOutcome = "booked" | "advanced" | "skipped" | "canceled" | "error";

async function processEvent(ev: GCalEvent): Promise<EventOutcome> {
  const guest = pickGuest(ev);
  const start = ev.start?.dateTime ?? ev.start?.date ?? null;
  const summary = (ev.summary ?? "").trim();

  // Cancellation: best-effort — if we can find the guest's booked deal, walk it back.
  if (ev.status === "cancelled") {
    if (!guest) return "skipped";
    const contactId = await findContactByEmail(guest.email);
    if (!contactId) return "skipped";
    const deal = await openDeal(contactId);
    if (deal && deal.stage === "demo-booked") {
      await supabaseAdmin.from("deals").update({ stage: "contacted", updated_at: new Date().toISOString() }).eq("id", deal.id);
      if (contactId) await cancelBooking({ contactId });
      await supabaseAdmin.from("contact_notes").insert({
        contact_id: contactId,
        text: "📅 Calendar demo canceled — moved back to contacted.",
        date: new Date().toISOString(),
        status: "warm",
      });
      return "canceled";
    }
    return "skipped";
  }

  // Confirmed/tentative bookings need a guest to attach to a contact.
  if (!guest) {
    console.info("[gcal_poll] event has no guest attendee, skipping", { id: ev.id, summary });
    return "skipped";
  }
  if (!start) return "skipped";

  // Find or create the contact.
  let contactId = await findContactByEmail(guest.email);
  if (!contactId) {
    const parts = (guest.name || guest.email.split("@")[0]).split(" ");
    const ins = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: parts[0] || "there",
        last_name: parts.slice(1).join(" "),
        email_jsonb: [{ email: guest.email, type: "Work" }],
        lead_source: "inbound",
        background: "Booked a demo on the Google Calendar.",
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ins.error) {
      console.error("[gcal_poll] contact insert failed", ins.error);
      return "error";
    }
    contactId = ins.data.id;
  }

  const deal = await openDeal(contactId);
  const nextAction = `Demo ${fmtDemoTime(start)}`.slice(0, 200);
  const nextActionDate = new Date(start).toISOString().slice(0, 10);

  // Existing deal already at/past demo-booked → leave it (idempotent re-poll).
  if (deal && !ADVANCEABLE.includes(deal.stage)) return "skipped";

  let dealId: number;
  if (deal) {
    await supabaseAdmin
      .from("deals")
      .update({ stage: "demo-booked", next_action: nextAction, next_action_date: nextActionDate, updated_at: new Date().toISOString() })
      .eq("id", deal.id);
    dealId = deal.id;
  } else {
    const d = await supabaseAdmin
      .from("deals")
      .insert({
        name: guest.name || summary || guest.email,
        stage: "demo-booked",
        category: "inbound",
        contact_ids: [contactId],
        next_action: nextAction,
        next_action_date: nextActionDate,
      })
      .select("id")
      .single();
    if (d.error) {
      console.error("[gcal_poll] deal insert failed", d.error);
      return "error";
    }
    dealId = d.data.id;
  }

  await assignToCloser({ dealId, contactId, reason: "demo_booked", summary: `Demo booked (calendar) for ${fmtDemoTime(start)}` });
  // Mirror the booked demo into the bookings table (best-effort, idempotent).
  if (contactId) await recordBooking({ contactId, scheduledFor: start, notes: "Demo booked via Google Calendar" });
  await supabaseAdmin.from("contact_notes").insert({
    contact_id: contactId,
    text: `📅 Demo booked via Google Calendar for ${fmtDemoTime(start)} — logged to pipeline.`,
    date: new Date().toISOString(),
    status: "hot",
  });
  return deal ? "advanced" : "booked";
}

// One page-walking pass over the calendar. Returns the events + the new sync
// token, or gone=true if the stored sync token expired (410) and we must reset.
async function listEvents(
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
): Promise<{ items: GCalEvent[]; nextSyncToken: string | null; gone: boolean }> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const items: GCalEvent[] = [];
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;

  do {
    const params = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
    if (syncToken) {
      params.set("syncToken", syncToken);
      params.set("showDeleted", "true");
    } else {
      params.set("timeMin", new Date().toISOString());
      params.set("orderBy", "startTime");
    }
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${base}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410) return { items: [], nextSyncToken: null, gone: true };
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Calendar API ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);

    for (const it of body.items ?? []) items.push(it as GCalEvent);
    pageToken = body.nextPageToken ?? null;
    nextSyncToken = body.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return { items, nextSyncToken, gone: false };
}

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  const expected = Deno.env.get("DISPATCH_TASKS_TOKEN");
  const provided = req.headers.get("X-DISPATCH-TOKEN");
  if (!expected || provided !== expected) return createErrorResponse(401, "Unauthorized");

  const calendarId = await secret("GCAL_CALENDAR_ID");
  if (!calendarId) return createErrorResponse(503, "GCAL_CALENDAR_ID not set");

  const closerId = Number((await secret("CLOSER_SALES_ID")) ?? "4");
  const tok = await getGoogleAccessToken(closerId);
  if (tok.error || !tok.access_token) {
    return createErrorResponse(502, `Google auth: ${tok.error ?? "no token"}`);
  }

  let syncToken = await secret("GCAL_SYNC_TOKEN");
  let listed = await listEvents(tok.access_token, calendarId, syncToken);
  if (listed.gone) {
    console.warn("[gcal_poll] sync token expired — full resync");
    syncToken = null;
    listed = await listEvents(tok.access_token, calendarId, null);
  }

  const summary: Record<string, number> = { processed: 0, booked: 0, advanced: 0, canceled: 0, skipped: 0, error: 0 };
  for (const ev of listed.items) {
    summary.processed++;
    try {
      summary[await processEvent(ev)]++;
    } catch (e) {
      console.error("[gcal_poll] event threw", ev.id, e);
      summary.error++;
    }
  }

  if (listed.nextSyncToken) await setSecret("GCAL_SYNC_TOKEN", listed.nextSyncToken);

  return new Response(JSON.stringify({ ok: true, calendar: calendarId, ...summary }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

// Create Google Calendar events (and check free/busy) on a sales rep's calendar,
// reusing the same OAuth client + stored refresh token as Gmail/gcal_poll.
//
// SCOPE REQUIREMENT: creating events needs the WRITE scope
// `https://www.googleapis.com/auth/calendar.events`. The Gmail-connect flow must
// have requested it and the rep must have re-consented; otherwise insert returns
// 403 insufficient scope. (free/busy only needs the existing calendar.readonly.)

import { getGoogleAccessToken } from "./googleToken.ts";

const CAL_API = "https://www.googleapis.com/calendar/v3";

export interface CreateEventResult {
  ok: boolean;
  eventId?: string;
  htmlLink?: string;
  meetUrl?: string;
  error?: string;
}

// Creates an event on the rep's PRIMARY calendar. The connected account is the
// organizer (so it lands on their calendar automatically); `attendeeEmails` are
// invited and emailed (sendUpdates=all). When addMeet is set, Google generates a
// Meet link returned as meetUrl.
export async function createCalendarEvent(opts: {
  salesId: number;
  summary: string;
  description?: string;
  startISO: string;
  durationMinutes: number;
  timeZone: string;
  attendeeEmails?: string[];
  addMeet?: boolean;
}): Promise<CreateEventResult> {
  const tok = await getGoogleAccessToken(opts.salesId);
  if (!tok.access_token) return { ok: false, error: tok.error || "no Google access token" };

  const startMs = Date.parse(opts.startISO);
  if (!Number.isFinite(startMs)) return { ok: false, error: "invalid startISO" };
  const endISO = new Date(startMs + opts.durationMinutes * 60_000).toISOString();

  const body: Record<string, unknown> = {
    summary: opts.summary,
    description: opts.description ?? "",
    start: { dateTime: opts.startISO, timeZone: opts.timeZone },
    end: { dateTime: endISO, timeZone: opts.timeZone },
  };

  const emails = (opts.attendeeEmails ?? []).filter((e) => typeof e === "string" && e.includes("@"));
  if (emails.length) body.attendees = emails.map((email) => ({ email }));

  if (opts.addMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `rl-${opts.salesId}-${startMs}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const url = `${CAL_API}/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: `calendar insert ${res.status}: ${JSON.stringify(j).slice(0, 200)}` };
  }

  const entryPoints = Array.isArray(j?.conferenceData?.entryPoints) ? j.conferenceData.entryPoints : [];
  const meetUrl: string | undefined =
    j.hangoutLink ||
    entryPoints.find((e: { entryPointType?: string; uri?: string }) => e?.entryPointType === "video")?.uri;

  return { ok: true, eventId: j.id, htmlLink: j.htmlLink, meetUrl };
}

// Returns whether the rep is free across [startISO, endISO]. Fail-OPEN: if the
// check errors (no token, API hiccup) it returns free=true so we never block a
// booking on a flaky read.
export async function getFreeBusy(opts: {
  salesId: number;
  startISO: string;
  endISO: string;
}): Promise<{ free: boolean; error?: string }> {
  const tok = await getGoogleAccessToken(opts.salesId);
  if (!tok.access_token) return { free: true, error: tok.error || "no Google access token" };

  const res = await fetch(`${CAL_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: opts.startISO, timeMax: opts.endISO, items: [{ id: "primary" }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { free: true, error: `freebusy ${res.status}` };

  const busy = j?.calendars?.primary?.busy ?? [];
  return { free: Array.isArray(busy) ? busy.length === 0 : true };
}

/** Raw busy intervals over a window. Empty array on any failure (caller decides). */
async function busyIntervals(opts: {
  salesId: number;
  startISO: string;
  endISO: string;
}): Promise<{ intervals: Array<{ start: number; end: number }>; error?: string }> {
  const tok = await getGoogleAccessToken(opts.salesId);
  if (!tok.access_token) {
    return { intervals: [], error: tok.error || "no Google access token" };
  }

  const res = await fetch(`${CAL_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: opts.startISO, timeMax: opts.endISO, items: [{ id: "primary" }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { intervals: [], error: `freebusy ${res.status}` };

  const busy = Array.isArray(j?.calendars?.primary?.busy) ? j.calendars.primary.busy : [];
  return {
    intervals: busy
      .map((b: { start?: string; end?: string }) => ({
        start: Date.parse(b?.start ?? ""),
        end: Date.parse(b?.end ?? ""),
      }))
      .filter((b: { start: number; end: number }) => Number.isFinite(b.start) && Number.isFinite(b.end)),
  };
}

/** What hour is `ms` in `timeZone`? Used to keep slots inside business hours. */
function zonedParts(ms: number, timeZone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, weekday };
}

/**
 * Real open slots on the closer's calendar — the fix for the agent inventing times.
 * The old nurture text promised "tomorrow at 9am or 4:30pm" to 73 different people
 * with nothing on the calendar behind it; the agent must only ever offer slots this
 * function actually returned.
 *
 * Walks the next `daysAhead` days on a 30-minute grid, weekdays only, inside
 * business hours in `timeZone`, skipping anything overlapping a busy block and
 * anything less than an hour away. Returns [] (never fabricated times) when the
 * calendar can't be read, so the caller falls back to the booking link.
 */
export async function findOpenSlots(opts: {
  salesId: number;
  timeZone: string;
  durationMinutes?: number;
  daysAhead?: number;
  count?: number;
  businessHours?: { start: number; end: number };
}): Promise<{ slots: string[]; error?: string }> {
  const duration = (opts.durationMinutes ?? 15) * 60_000;
  const daysAhead = opts.daysAhead ?? 5;
  const want = opts.count ?? 3;
  const hours = opts.businessHours ?? { start: 9, end: 17 };

  const now = Date.now();
  const from = now + 60 * 60_000; // never offer something under an hour out
  const to = now + daysAhead * 24 * 60 * 60_000;

  const { intervals, error } = await busyIntervals({
    salesId: opts.salesId,
    startISO: new Date(now).toISOString(),
    endISO: new Date(to).toISOString(),
  });
  if (error) return { slots: [], error };

  const overlapsBusy = (start: number, end: number) =>
    intervals.some((b) => start < b.end && end > b.start);

  const STEP = 30 * 60_000;
  const slots: string[] = [];
  // Align the first candidate to the next half hour.
  let cursor = Math.ceil(from / STEP) * STEP;

  while (cursor < to && slots.length < want) {
    const end = cursor + duration;
    const { hour, weekday } = zonedParts(cursor, opts.timeZone);
    const isWeekday = !["Sat", "Sun"].includes(weekday);
    // end-1ms so a slot finishing exactly at close still counts as inside hours.
    const endHour = zonedParts(end - 1, opts.timeZone).hour;

    if (isWeekday && hour >= hours.start && endHour < hours.end && !overlapsBusy(cursor, end)) {
      slots.push(new Date(cursor).toISOString());
      cursor += Math.max(duration, STEP) + 60 * 60_000; // spread offers out
      continue;
    }
    cursor += STEP;
  }

  return { slots };
}

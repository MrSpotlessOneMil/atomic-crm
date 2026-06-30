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

// Human call cadence ("double dials") for warm inbound leads.
//
// One row = one double-dial SESSION (the rep calls twice back-to-back). The
// cadence is scheduled into scheduled_tasks as task_type 'call_task' at enroll
// time; dispatch_tasks bridges each due step into the human `tasks` table
// (type 'call') + a 'call_due' notification, so reps see a CALL NOW queue.
//
// Cadence source: Hormozi's $100M Playbook "Lead Nurture", Pillar IV: Volume
// (scheduling appointments, steps 1-8): call within 5 minutes of opt-in
// (double-dial; no answer -> voicemail + text right after), two more
// double-dial+text attempts the same day a few hours apart, two calls a day
// (early + late) for the next two days, one call+text a day for the next four
// days, then hand over to long-term nurture after the first week (our email
// drip runs to day 30). Front-load the reach-outs - the more days pass, the
// less likely they schedule. Steps 6-7 are flexible by design; tune here.
//
// This module is PURE (no supabase / Deno imports) so vitest can run it in node.

export interface CallStep {
  day: number; // days after enrollment (0 = the day the lead arrives)
  hour: number | null; // local hour (0-23) in the lead's tz; null = right now
}

export const CALL_CADENCE: CallStep[] = [
  { day: 0, hour: null }, // speed-to-lead: call within minutes of the lead landing
  { day: 0, hour: 13 }, // second push a few hours later
  { day: 0, hour: 17 }, // third push to close out day one
  { day: 1, hour: 10 },
  { day: 1, hour: 16 },
  { day: 2, hour: 10 },
  { day: 2, hour: 16 },
  { day: 3, hour: 10 },
  { day: 4, hour: 10 },
  { day: 5, hour: 10 },
  { day: 6, hour: 10 },
];

export const DEFAULT_CALL_TZ = "America/New_York";

function partsInTz(date: Date, tz: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute") };
}

// UTC instant for local {y,m,d,h}:00 in tz. Two-pass offset correction handles
// DST transitions well enough for a call scheduler.
function utcFromZoned(y: number, m: number, d: number, h: number, tz: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, 0, 0);
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, h, 0, 0) - asUtc;
  }
  return new Date(guess);
}

// When step {day, hour} should fire, given enrollment at `now`. Rules:
//   * hour null -> now (immediate speed-to-lead call).
//   * a day-0 step whose local hour already passed -> clamp to now (call the
//     fresh lead anyway; the dispatcher's coalesce guard collapses stacked
//     steps and quiet hours defer late-night ones to morning).
//   * a later-day step that somehow lands in the past -> null (drop it).
export function computeRunAt(now: Date, day: number, hour: number | null, tz: string): Date | null {
  if (hour === null) return now;
  let target: Date;
  try {
    const local = partsInTz(new Date(now.getTime() + day * 86_400_000), tz);
    target = utcFromZoned(local.y, local.m, local.d, hour, tz);
  } catch {
    // Unknown tz -> naive fallback so a bad tz never drops the cadence.
    target = new Date(now.getTime() + day * 86_400_000);
  }
  if (target.getTime() < now.getTime()) {
    return day === 0 ? now : null;
  }
  return target;
}

export interface CallCadenceRow {
  task_type: "call_task";
  contact_id: number;
  deal_id: number | null;
  payload: Record<string, unknown>;
  run_at: string;
}

// scheduled_tasks rows for the full cadence. `enrolled_at` lets the dispatcher
// cancel remaining steps once the lead replies on any channel.
export function buildCallCadenceRows(opts: {
  contactId: number;
  dealId: number | null;
  source?: string;
  leadMagnet?: string;
  now?: Date;
  tz?: string;
  cadence?: CallStep[];
}): CallCadenceRow[] {
  const now = opts.now ?? new Date();
  const tz = opts.tz || DEFAULT_CALL_TZ;
  const cadence = opts.cadence ?? CALL_CADENCE;
  const runAts: Date[] = [];
  for (const step of cadence) {
    const at = computeRunAt(now, step.day, step.hour, tz);
    if (at) runAts.push(at);
  }
  const of = runAts.length;
  return runAts.map((at, i) => ({
    task_type: "call_task",
    contact_id: opts.contactId,
    deal_id: opts.dealId,
    payload: {
      key: `dd_${i + 1}`,
      step: i + 1,
      of,
      double_dial: true,
      tz,
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.leadMagnet ? { lead_magnet: opts.leadMagnet } : {}),
      enrolled_at: now.toISOString(),
    },
    run_at: at.toISOString(),
  }));
}

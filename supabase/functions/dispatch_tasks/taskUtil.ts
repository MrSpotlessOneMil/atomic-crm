// Shared primitives for scheduled_tasks handlers (dispatch_tasks + its task
// modules). Extracted from index.ts so handlers in separate files (callTask.ts)
// and their vitest suites use ONE copy of the row shape, quiet-hours logic, and
// status updates.

import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

export interface TaskRow {
  id: number;
  deal_id: number | null;
  contact_id: number | null;
  task_type: string;
  payload: Record<string, unknown>;
  run_at: string;
  attempts: number;
  created_at?: string;
}

export type Outcome = "sent" | "skipped" | "deferred" | "failed";

export const MAX_ATTEMPTS = 5;

// contacts.phone_jsonb is an array of { number, type } (or, defensively, strings).
export function firstPhone(
  contact: { phone_jsonb?: unknown } | null,
  payloadTo?: unknown,
): string | null {
  if (typeof payloadTo === "string" && payloadTo.trim()) return payloadTo;
  const pj = contact?.phone_jsonb;
  if (Array.isArray(pj)) {
    for (const entry of pj) {
      if (typeof entry === "string" && entry.trim()) return entry;
      if (entry && typeof entry === "object") {
        const n = (entry as Record<string, unknown>).number;
        if (typeof n === "string" && n.trim()) return n;
      }
    }
  }
  return null;
}

// Quiet hours: no automated SMS (or CALL NOW bridging) before 8am or at/after
// 8pm in the lead's tz.
// TODO(Phase 1): set payload.tz from the lead's area code at enqueue time.
export function isQuietHours(tz: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    }).formatToParts(new Date());
    const h =
      parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10) % 24;
    return h < 8 || h >= 20;
  } catch {
    return false; // unknown tz → don't block the send
  }
}

export function defaultTz(payloadTz: unknown): string {
  const envGet = (
    globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }
  ).Deno?.env?.get;
  return (
    (typeof payloadTz === "string" && payloadTz) ||
    envGet?.("QUIET_HOURS_TZ") ||
    "America/New_York"
  );
}

// Quiet-hours defer target: milliseconds until the lead's NEXT 8am, plus a
// deterministic stagger that preserves cadence order. The old "+1h and
// re-check" loop made every overnight task land at ~8am in batch order — the
// day-1 texts arrived shuffled and bunched. Stagger = minutes-since-enrollment
// mapped 0..8h -> 0..160min, monotonic in cadence position, so the opener
// beats the +3.5h nudge beats the +8h nudge, spread over ~2.5h after 8am.
export function quietHoursDeferMs(tz: string, enrolledAt?: unknown): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      timeZone: tz,
    }).formatToParts(new Date());
    const get = (t: string) =>
      parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
    const h = get("hour") % 24;
    const m = get("minute");
    let delta = (8 * 60 - (h * 60 + m) + 1440) % 1440;
    if (delta === 0) delta = 1;
    let stagger = 0;
    if (typeof enrolledAt === "string") {
      const hours = (Date.now() - Date.parse(enrolledAt)) / 3600_000;
      if (Number.isFinite(hours))
        stagger = Math.min(Math.max(hours, 0), 8) * 20;
    }
    return (delta + stagger) * 60_000;
  } catch {
    return 60 * 60_000; // unknown tz -> old behavior, retry in an hour
  }
}

export async function setStatus(id: number, fields: Record<string, unknown>) {
  await supabaseAdmin
    .from("scheduled_tasks")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
}

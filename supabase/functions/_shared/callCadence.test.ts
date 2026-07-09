// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CALL_CADENCE, buildCallCadenceRows, computeRunAt } from "./callCadence";

const TZ = "America/New_York";

function hourInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: tz,
  }).formatToParts(date);
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "-1", 10) % 24;
}

describe("computeRunAt", () => {
  it("fires immediately when hour is null (speed-to-lead)", () => {
    const now = new Date("2026-07-09T15:00:00Z");
    expect(computeRunAt(now, 0, null, TZ)).toEqual(now);
  });

  it("targets the requested local hour on a future day", () => {
    const now = new Date("2026-07-09T15:00:00Z"); // 11:00 in New York (EDT)
    const at = computeRunAt(now, 1, 10, TZ)!;
    expect(hourInTz(at, TZ)).toBe(10);
    expect(at.getTime()).toBeGreaterThan(now.getTime());
  });

  it("hits the local hour across DST (winter vs summer)", () => {
    const winter = computeRunAt(new Date("2026-01-15T15:00:00Z"), 2, 16, TZ)!;
    const summer = computeRunAt(new Date("2026-07-15T15:00:00Z"), 2, 16, TZ)!;
    expect(hourInTz(winter, TZ)).toBe(16);
    expect(hourInTz(summer, TZ)).toBe(16);
  });

  it("clamps a day-0 step whose local hour already passed to now", () => {
    const now = new Date("2026-07-09T23:30:00Z"); // 19:30 in New York — 16:00 passed
    expect(computeRunAt(now, 0, 16, TZ)).toEqual(now);
  });

  it("falls back to a naive day offset on an unknown tz instead of dropping", () => {
    const now = new Date("2026-07-09T15:00:00Z");
    const at = computeRunAt(now, 2, 10, "Not/AZone")!;
    expect(at.getTime()).toBe(now.getTime() + 2 * 86_400_000);
  });
});

describe("buildCallCadenceRows", () => {
  const now = new Date("2026-07-09T14:00:00Z"); // 10:00 in New York — all steps future
  const rows = buildCallCadenceRows({
    contactId: 7,
    dealId: 42,
    source: "facebook",
    leadMagnet: "Automation Playbook",
    now,
    tz: TZ,
  });

  it("produces one row per cadence step with dd_N keys and step/of", () => {
    expect(rows).toHaveLength(CALL_CADENCE.length);
    rows.forEach((r, i) => {
      expect(r.task_type).toBe("call_task");
      expect(r.contact_id).toBe(7);
      expect(r.deal_id).toBe(42);
      expect(r.payload.key).toBe(`dd_${i + 1}`);
      expect(r.payload.step).toBe(i + 1);
      expect(r.payload.of).toBe(rows.length);
      expect(r.payload.double_dial).toBe(true);
      expect(r.payload.tz).toBe(TZ);
      expect(r.payload.source).toBe("facebook");
      expect(r.payload.lead_magnet).toBe("Automation Playbook");
      expect(r.payload.enrolled_at).toBe(now.toISOString());
    });
  });

  it("schedules ascending run_at with the first step immediate", () => {
    expect(rows[0].run_at).toBe(now.toISOString());
    const times = rows.map((r) => Date.parse(r.run_at));
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it("omits optional payload fields when not provided", () => {
    const bare = buildCallCadenceRows({ contactId: 1, dealId: null, now, tz: TZ });
    expect(bare[0].payload.source).toBeUndefined();
    expect(bare[0].payload.lead_magnet).toBeUndefined();
    expect(bare[0].deal_id).toBeNull();
  });
});

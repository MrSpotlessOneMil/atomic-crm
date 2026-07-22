// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findOpenSlots } from "./googleCalendar";

const mockToken = vi.hoisted(() => vi.fn());

vi.mock("./googleToken.ts", () => ({
  getGoogleAccessToken: (...args: unknown[]) => mockToken(...args),
}));

vi.mock("./supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }) },
}));

const TZ = "America/Los_Angeles";
let busy: Array<{ start: string; end: string }> = [];
let fetchOk = true;

beforeEach(() => {
  vi.clearAllMocks();
  busy = [];
  fetchOk = true;
  mockToken.mockResolvedValue({ access_token: "tok" });

  // Wednesday 2026-07-22, 08:00 America/Los_Angeles (15:00Z).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T15:00:00Z"));

  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: fetchOk,
    status: fetchOk ? 200 : 500,
    json: async () => ({ calendars: { primary: { busy } } }),
  })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("findOpenSlots", () => {
  it("returns real future slots inside business hours", async () => {
    const { slots } = await findOpenSlots({ salesId: 4, timeZone: TZ });
    expect(slots).toHaveLength(3);
    for (const iso of slots) {
      const ms = Date.parse(iso);
      expect(ms).toBeGreaterThan(Date.now());
      const hour = Number(
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false })
          .format(new Date(ms)),
      );
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
    }
  });

  it("never offers a slot less than an hour out", async () => {
    const { slots } = await findOpenSlots({ salesId: 4, timeZone: TZ });
    expect(Date.parse(slots[0])).toBeGreaterThanOrEqual(Date.now() + 60 * 60_000);
  });

  it("skips times that collide with a busy block", async () => {
    // Block the whole first day (16:00Z-24:00Z = 9am-5pm PT).
    busy = [{ start: "2026-07-22T16:00:00Z", end: "2026-07-23T00:00:00Z" }];
    const { slots } = await findOpenSlots({ salesId: 4, timeZone: TZ });
    for (const iso of slots) {
      expect(Date.parse(iso)).toBeGreaterThanOrEqual(Date.parse("2026-07-23T00:00:00Z"));
    }
  });

  it("returns NO slots (never invented ones) when the calendar cannot be read", async () => {
    mockToken.mockResolvedValue({ access_token: null, error: "no scope" });
    const { slots, error } = await findOpenSlots({ salesId: 4, timeZone: TZ });
    expect(slots).toEqual([]);
    expect(error).toBeTruthy();
  });

  it("returns NO slots when the freebusy call fails", async () => {
    fetchOk = false;
    const { slots, error } = await findOpenSlots({ salesId: 4, timeZone: TZ });
    expect(slots).toEqual([]);
    expect(error).toBeTruthy();
  });

  it("skips weekends", async () => {
    // Friday 2026-07-24 16:00 PT - the next slots must land on Monday.
    vi.setSystemTime(new Date("2026-07-24T23:30:00Z"));
    const { slots } = await findOpenSlots({ salesId: 4, timeZone: TZ });
    for (const iso of slots) {
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" })
        .format(new Date(iso));
      expect(["Sat", "Sun"]).not.toContain(weekday);
    }
  });
});

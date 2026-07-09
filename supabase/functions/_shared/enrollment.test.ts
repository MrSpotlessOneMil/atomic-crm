// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrollLeadCadence, ensureOpenDeal } from "./enrollment";
import { NURTURE, EMAIL_NURTURE } from "./salesCopy";
import { CALL_CADENCE } from "./callCadence";

const mockFrom = vi.hoisted(() => vi.fn());
const mockIdsByIdentity = vi.hoisted(() => vi.fn());
const mockHasCadence = vi.hoisted(() => vi.fn());
const mockHasCallCadence = vi.hoisted(() => vi.fn());

vi.mock("./supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => mockFrom(...args) },
}));

vi.mock("./contactIdentity.ts", () => ({
  contactIdsByIdentity: (...args: unknown[]) => mockIdsByIdentity(...args),
  hasRecentCadence: (...args: unknown[]) => mockHasCadence(...args),
  hasRecentCallCadence: (...args: unknown[]) => mockHasCallCadence(...args),
}));

let floodCount = 0;
let insertedRows: Record<string, unknown>[] | null = null;
let openDeals: { id: number }[] = [];
let dealInsertResult: { data?: unknown; error?: unknown } = { data: { id: 900 }, error: null };

function awaitable(value: unknown) {
  const p = Promise.resolve(value);
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "in", "contains", "limit", "order"]) chain[m] = () => chain;
  chain.single = () => p;
  chain.maybeSingle = () => p;
  chain.then = (...args: Parameters<Promise<unknown>["then"]>) => p.then(...args);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  floodCount = 0;
  insertedRows = null;
  openDeals = [];
  dealInsertResult = { data: { id: 900 }, error: null };
  mockIdsByIdentity.mockResolvedValue([5]);
  mockHasCadence.mockResolvedValue(false);
  mockHasCallCadence.mockResolvedValue(false);

  mockFrom.mockImplementation((table: string) => {
    if (table === "scheduled_tasks") {
      return {
        select: () => ({ gte: () => Promise.resolve({ count: floodCount }) }),
        insert: (rows: Record<string, unknown>[]) => {
          insertedRows = rows;
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === "deals") {
      return {
        ...awaitable({ data: openDeals }),
        insert: () => ({
          select: () => ({ single: () => Promise.resolve(dealInsertResult) }),
        }),
      };
    }
    return awaitable({ data: [] });
  });
});

const BASE = {
  contactId: 5,
  dealId: 10,
  source: "facebook",
  magnet: "Automation Playbook",
  e164: "+13105550000",
  email: "naty@example.com",
};

describe("enrollLeadCadence", () => {
  it("skips cold sources entirely", async () => {
    const out = await enrollLeadCadence({ ...BASE, source: "cold-email" });
    expect(out).toMatchObject({ enqueued: 0, skipped: "cold source" });
    expect(insertedRows).toBeNull();
  });

  it("skips when there is no phone and no email", async () => {
    const out = await enrollLeadCadence({ ...BASE, e164: null, email: null });
    expect(out.skipped).toBe("no phone or email");
  });

  it("skips when both messaging and call cadences already exist for the identity", async () => {
    mockHasCadence.mockResolvedValue(true);
    mockHasCallCadence.mockResolvedValue(true);
    const out = await enrollLeadCadence(BASE);
    expect(out.skipped).toBe("cadence already active");
    expect(insertedRows).toBeNull();
  });

  it("skips on the flood cap", async () => {
    floodCount = 61;
    const out = await enrollLeadCadence(BASE);
    expect(out.skipped).toBe("flood cap");
    expect(insertedRows).toBeNull();
  });

  it("enqueues the FULL drip for a fresh phone+email lead: sms + email + call cadence", async () => {
    const out = await enrollLeadCadence(BASE);
    const expected = 1 + NURTURE.length + 1 + EMAIL_NURTURE.length + CALL_CADENCE.length;
    expect(out.enqueued).toBe(expected);
    expect(out.callSteps).toBe(CALL_CADENCE.length);

    const types = (insertedRows ?? []).map((r) => r.task_type);
    expect(types.filter((t) => t === "speed_to_lead_sms")).toHaveLength(1);
    expect(types.filter((t) => t === "nurture_sms")).toHaveLength(NURTURE.length);
    expect(types.filter((t) => t === "speed_to_lead_email")).toHaveLength(1);
    expect(types.filter((t) => t === "nurture_email")).toHaveLength(EMAIL_NURTURE.length);
    expect(types.filter((t) => t === "call_task")).toHaveLength(CALL_CADENCE.length);

    // The opener names the magnet the lead grabbed.
    const opener = (insertedRows ?? []).find((r) => (r.payload as Record<string, unknown>).key === "opener");
    expect(String((opener!.payload as Record<string, unknown>).content)).toContain("Automation Playbook");
  });

  it("uses the audit opener for audit-form leads", async () => {
    await enrollLeadCadence({ ...BASE, source: "website", magnet: "PDF Audit" });
    const opener = (insertedRows ?? []).find((r) => (r.payload as Record<string, unknown>).key === "opener");
    expect(String((opener!.payload as Record<string, unknown>).content)).toContain("audit request");
  });

  it("adds ONLY the call cadence when messaging already exists but calls do not", async () => {
    mockHasCadence.mockResolvedValue(true);
    mockHasCallCadence.mockResolvedValue(false);
    const out = await enrollLeadCadence(BASE);
    expect(out.enqueued).toBe(CALL_CADENCE.length);
    expect(out.callSteps).toBe(CALL_CADENCE.length);
    expect((insertedRows ?? []).every((r) => r.task_type === "call_task")).toBe(true);
  });

  it("email-only leads get the email drip and no call cadence", async () => {
    const out = await enrollLeadCadence({ ...BASE, e164: null });
    expect(out.callSteps).toBe(0);
    const types = (insertedRows ?? []).map((r) => r.task_type);
    expect(types).not.toContain("call_task");
    expect(types).not.toContain("speed_to_lead_sms");
    expect(types.filter((t) => t === "nurture_email")).toHaveLength(EMAIL_NURTURE.length);
  });
});

describe("ensureOpenDeal", () => {
  it("returns the existing open deal", async () => {
    openDeals = [{ id: 77 }];
    const id = await ensureOpenDeal({ contactId: 5, name: "Naty", source: "facebook" });
    expect(id).toBe(77);
  });

  it("creates a deal at stage lead when none is open", async () => {
    const id = await ensureOpenDeal({ contactId: 5, name: "Naty", source: "facebook" });
    expect(id).toBe(900);
  });

  it("returns null when the insert fails", async () => {
    dealInsertResult = { data: null, error: { message: "nope" } };
    const id = await ensureOpenDeal({ contactId: 5, name: "Naty", source: "facebook" });
    expect(id).toBeNull();
  });
});

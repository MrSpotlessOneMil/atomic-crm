// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrollLeadCadence, ensureOpenDeal } from "./enrollment";
import {
  NURTURE,
  NURTURE_ES,
  LONGTERM_SMS,
  EMAIL_NURTURE,
  LONGTERM_EMAIL,
  STOP_LINE,
} from "./salesCopy";
import { CALL_CADENCE } from "./callCadence";

const mockFrom = vi.hoisted(() => vi.fn());
const mockIdsByIdentity = vi.hoisted(() => vi.fn());
const mockHasSmsCadence = vi.hoisted(() => vi.fn());
const mockHasEmailCadence = vi.hoisted(() => vi.fn());
const mockHasCallCadence = vi.hoisted(() => vi.fn());

vi.mock("./supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => mockFrom(...args) },
}));

vi.mock("./contactIdentity.ts", () => ({
  contactIdsByIdentity: (...args: unknown[]) => mockIdsByIdentity(...args),
  hasRecentSmsCadence: (...args: unknown[]) => mockHasSmsCadence(...args),
  hasRecentEmailCadence: (...args: unknown[]) => mockHasEmailCadence(...args),
  hasRecentCallCadence: (...args: unknown[]) => mockHasCallCadence(...args),
}));

let floodCount = 0;
let insertedRows: Record<string, unknown>[] | null = null;
let openDeals: { id: number }[] = [];
let dealInsertResult: { data?: unknown; error?: unknown } = {
  data: { id: 900 },
  error: null,
};

function awaitable(value: unknown) {
  const p = Promise.resolve(value);
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "in", "contains", "limit", "order"])
    chain[m] = () => chain;
  chain.single = () => p;
  chain.maybeSingle = () => p;
  chain.then = (...args: Parameters<Promise<unknown>["then"]>) =>
    p.then(...args);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  floodCount = 0;
  insertedRows = null;
  openDeals = [];
  dealInsertResult = { data: { id: 900 }, error: null };
  mockIdsByIdentity.mockResolvedValue([5]);
  mockHasSmsCadence.mockResolvedValue(false);
  mockHasEmailCadence.mockResolvedValue(false);
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

const payloadOf = (r: Record<string, unknown>) =>
  r.payload as Record<string, unknown>;
const rowsByKey = (key: string) =>
  (insertedRows ?? []).filter((r) => payloadOf(r).key === key);

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
    mockHasSmsCadence.mockResolvedValue(true);
    mockHasEmailCadence.mockResolvedValue(true);
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

  it("enqueues the FULL playbook drip for a fresh phone+email lead: sms + long-term + email + call cadence", async () => {
    const out = await enrollLeadCadence(BASE);
    const expected =
      1 +
      NURTURE.length +
      LONGTERM_SMS.length +
      1 +
      EMAIL_NURTURE.length +
      CALL_CADENCE.length;
    expect(out.enqueued).toBe(expected);
    expect(out.callSteps).toBe(CALL_CADENCE.length);

    const types = (insertedRows ?? []).map((r) => r.task_type);
    expect(types.filter((t) => t === "speed_to_lead_sms")).toHaveLength(1);
    expect(types.filter((t) => t === "nurture_sms")).toHaveLength(
      NURTURE.length + LONGTERM_SMS.length,
    );
    expect(types.filter((t) => t === "speed_to_lead_email")).toHaveLength(1);
    expect(types.filter((t) => t === "nurture_email")).toHaveLength(
      EMAIL_NURTURE.length,
    );
    expect(types.filter((t) => t === "call_task")).toHaveLength(
      CALL_CADENCE.length,
    );

    // The opener names the magnet the lead grabbed AND carries the one-time
    // opt-out line (first text only).
    const opener = rowsByKey("opener")[0];
    expect(String(payloadOf(opener).content)).toContain("Automation Playbook");
    expect(String(payloadOf(opener).content)).toContain(STOP_LINE.en);
    const anyNurture = (insertedRows ?? []).find(
      (r) => r.task_type === "nurture_sms",
    );
    expect(String(payloadOf(anyNurture!).content)).not.toContain(STOP_LINE.en);
  });

  it("stamps enrolled_at and the area-code tz on messaging rows (LA number -> Pacific)", async () => {
    await enrollLeadCadence(BASE); // +1310... = Los Angeles
    const opener = rowsByKey("opener")[0];
    expect(payloadOf(opener).enrolled_at).toBeTruthy();
    expect(payloadOf(opener).tz).toBe("America/Los_Angeles");
  });

  it("threads the day-3 email into the opener (thread_with)", async () => {
    await enrollLeadCadence(BASE);
    const bump = rowsByKey("email_bump_3d")[0];
    expect(payloadOf(bump).thread_with).toBe("email_opener");
  });

  it("uses the audit opener for audit-form leads", async () => {
    await enrollLeadCadence({
      ...BASE,
      source: "website",
      magnet: "PDF Audit",
    });
    const opener = rowsByKey("opener")[0];
    expect(String(payloadOf(opener).content)).toContain("audit request");
  });

  it("Spanish leads get the ES track end-to-end", async () => {
    await enrollLeadCadence({ ...BASE, language: "es" });
    const opener = rowsByKey("opener")[0];
    expect(String(payloadOf(opener).content)).toContain("soy robin");
    expect(String(payloadOf(opener).content)).toContain(STOP_LINE.es);
    const keys = (insertedRows ?? [])
      .filter((r) => r.task_type === "nurture_sms")
      .map((r) => payloadOf(r).key);
    for (const s of NURTURE_ES) expect(keys).toContain(s.key);
    const engage = rowsByKey("nudge_engage")[0];
    expect(String(payloadOf(engage).content)).toContain("español");
  });

  it("adds ONLY the call cadence when messaging already exists but calls do not", async () => {
    mockHasSmsCadence.mockResolvedValue(true);
    mockHasEmailCadence.mockResolvedValue(true);
    mockHasCallCadence.mockResolvedValue(false);
    const out = await enrollLeadCadence(BASE);
    expect(out.enqueued).toBe(CALL_CADENCE.length);
    expect(out.callSteps).toBe(CALL_CADENCE.length);
    expect((insertedRows ?? []).every((r) => r.task_type === "call_task")).toBe(
      true,
    );
  });

  it("partial-then-full: SMS drip still starts when only the email cadence exists", async () => {
    mockHasSmsCadence.mockResolvedValue(false);
    mockHasEmailCadence.mockResolvedValue(true);
    mockHasCallCadence.mockResolvedValue(false);
    const out = await enrollLeadCadence(BASE);
    const types = (insertedRows ?? []).map((r) => r.task_type);
    expect(types).toContain("speed_to_lead_sms");
    expect(types).toContain("call_task");
    expect(types).not.toContain("speed_to_lead_email");
    expect(types).not.toContain("nurture_email");
    expect(out.enqueued).toBe(
      1 + NURTURE.length + LONGTERM_SMS.length + CALL_CADENCE.length,
    );
  });

  it("email-only leads get the email drip (incl. long-term email) and no call cadence", async () => {
    const out = await enrollLeadCadence({ ...BASE, e164: null });
    expect(out.callSteps).toBe(0);
    const types = (insertedRows ?? []).map((r) => r.task_type);
    expect(types).not.toContain("call_task");
    expect(types).not.toContain("speed_to_lead_sms");
    expect(types.filter((t) => t === "nurture_email")).toHaveLength(
      EMAIL_NURTURE.length + LONGTERM_EMAIL.length,
    );
  });

  it("phone leads do NOT get the long-term email steps (SMS long-term covers them)", async () => {
    await enrollLeadCadence(BASE);
    const emailKeys = (insertedRows ?? [])
      .filter((r) => r.task_type === "nurture_email")
      .map((r) => payloadOf(r).key);
    expect(emailKeys).not.toContain("nineword_35d");
    const smsKeys = (insertedRows ?? [])
      .filter((r) => r.task_type === "nurture_sms")
      .map((r) => payloadOf(r).key);
    expect(smsKeys).toContain("nineword_35d");
    expect(smsKeys).toContain("proof_90d");
  });
});

describe("ensureOpenDeal", () => {
  it("returns the existing open deal", async () => {
    openDeals = [{ id: 77 }];
    const id = await ensureOpenDeal({
      contactId: 5,
      name: "Naty",
      source: "facebook",
    });
    expect(id).toBe(77);
  });

  it("creates a deal at stage lead when none is open", async () => {
    const id = await ensureOpenDeal({
      contactId: 5,
      name: "Naty",
      source: "facebook",
    });
    expect(id).toBe(900);
  });

  it("returns null when the insert fails", async () => {
    dealInsertResult = { data: null, error: { message: "nope" } };
    const id = await ensureOpenDeal({
      contactId: 5,
      name: "Naty",
      source: "facebook",
    });
    expect(id).toBeNull();
  });
});

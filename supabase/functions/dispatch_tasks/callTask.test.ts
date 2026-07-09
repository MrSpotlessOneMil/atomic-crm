// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callTaskText, handleCallTask } from "./callTask";
import type { TaskRow } from "./taskUtil";

const mockFrom = vi.hoisted(() => vi.fn());
const mockQuiet = vi.hoisted(() => vi.fn(() => false));

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock("./taskUtil.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, isQuietHours: (...args: unknown[]) => mockQuiet(...args) };
});

// ---------------------------------------------------------------------------
// Table-routed supabase mock. Each table gets a tiny chainable stub whose
// terminal value we control per test.
// ---------------------------------------------------------------------------

type TableSpec = {
  // resolved value for select-style chains: { data }
  selectData?: unknown;
  // insert result: { data, error }
  insert?: { data?: unknown; error?: unknown };
};

const inserted: Record<string, unknown[]> = {};
const statusUpdates: Record<string, unknown>[] = [];

function chainResolving(value: { data?: unknown; error?: unknown; count?: number }) {
  const p = Promise.resolve(value);
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "neq", "is", "gt", "gte", "lte", "in", "not", "contains", "order", "limit"]) {
    chain[m] = self;
  }
  chain.maybeSingle = () => p;
  chain.single = () => p;
  chain.then = (...args: Parameters<Promise<unknown>["then"]>) => p.then(...args);
  return chain;
}

function setupTables(spec: Record<string, TableSpec>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "scheduled_tasks") {
      // setStatus path: update(...).eq(id)
      return {
        update: (fields: Record<string, unknown>) => {
          statusUpdates.push(fields);
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    }
    const t = spec[table] ?? {};
    // "selectData: null" must stay null (e.g. maybeSingle "no row") — `??`
    // would turn it into a truthy [].
    return {
      ...chainResolving({ data: "selectData" in t ? t.selectData : [] }),
      insert: (row: unknown) => {
        (inserted[table] ??= []).push(row);
        const res = t.insert ?? { data: { id: 999 }, error: null };
        const p = Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
        return {
          select: () => ({ single: () => p }),
          then: (...args: Parameters<Promise<unknown>["then"]>) => p.then(...args),
        };
      },
    };
  });
}

const baseTask = (payload: Record<string, unknown> = {}): TaskRow => ({
  id: 1,
  deal_id: 10,
  contact_id: 5,
  task_type: "call_task",
  payload: {
    key: "dd_2",
    step: 2,
    of: 6,
    double_dial: true,
    tz: "America/New_York",
    source: "facebook",
    lead_magnet: "Automation Playbook",
    enrolled_at: "2026-07-08T00:00:00.000Z",
    ...payload,
  },
  run_at: "2026-07-09T14:00:00.000Z",
  attempts: 0,
});

const CONTACT = {
  id: 5,
  first_name: "Naty",
  last_name: "R",
  sales_id: 4,
  phone_jsonb: [{ number: "+13105550000", type: "Mobile" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockQuiet.mockReturnValue(false);
  statusUpdates.length = 0;
  for (const k of Object.keys(inserted)) delete inserted[k];
});

describe("callTaskText", () => {
  it("describes the double dial with step, phone, source and magnet", () => {
    expect(
      callTaskText({ step: 2, of: 6, phone: "+13105550000", source: "facebook", leadMagnet: "Playbook" }),
    ).toBe("Double dial 2/6 - call twice back-to-back - +13105550000 - via facebook (Playbook)");
  });
});

describe("handleCallTask", () => {
  it("cancels when the task has no contact", async () => {
    setupTables({});
    const out = await handleCallTask({ ...baseTask(), contact_id: null });
    expect(out).toBe("skipped");
    expect(statusUpdates[0]).toMatchObject({ status: "canceled", last_error: "no contact" });
  });

  it("cancels when the contact has no phone", async () => {
    setupTables({ contacts: { selectData: { ...CONTACT, phone_jsonb: [] } } });
    const out = await handleCallTask(baseTask());
    expect(out).toBe("skipped");
    expect(statusUpdates[0]).toMatchObject({ status: "canceled" });
  });

  it("cancels when the phone is suppressed (opt-out)", async () => {
    setupTables({
      contacts: { selectData: CONTACT },
      sms_suppressions: { selectData: { id: 1 } },
    });
    const out = await handleCallTask(baseTask());
    expect(out).toBe("skipped");
    expect(statusUpdates[0]).toMatchObject({ status: "canceled", last_error: "suppressed (opt-out)" });
  });

  it("cancels when the lead replied after enrollment", async () => {
    setupTables({
      contacts: { selectData: CONTACT },
      sms_suppressions: { selectData: null },
      agent_messages: { selectData: [{ id: 77 }] },
    });
    const out = await handleCallTask(baseTask());
    expect(out).toBe("skipped");
    expect(statusUpdates[0]).toMatchObject({ status: "canceled", last_error: "lead replied" });
  });

  it("coalesces when an open bridged call task already exists", async () => {
    setupTables({
      contacts: { selectData: CONTACT },
      sms_suppressions: { selectData: null },
      agent_messages: { selectData: [] },
      tasks: { selectData: [{ id: 55 }] },
    });
    const out = await handleCallTask(baseTask());
    expect(out).toBe("skipped");
    expect(statusUpdates[0]).toMatchObject({ status: "sent" });
    expect((statusUpdates[0].payload as Record<string, unknown>).coalesced).toBe(true);
    expect(inserted.tasks).toBeUndefined();
  });

  it("defers during quiet hours", async () => {
    mockQuiet.mockReturnValue(true);
    setupTables({
      contacts: { selectData: CONTACT },
      sms_suppressions: { selectData: null },
      agent_messages: { selectData: [] },
      tasks: { selectData: [] },
    });
    const out = await handleCallTask(baseTask());
    expect(out).toBe("deferred");
    expect(statusUpdates[0]).toMatchObject({ status: "pending" });
    expect(statusUpdates[0].run_at).toBeTruthy();
  });

  it("bridges to a tasks row + notifies the assigned rep on the happy path", async () => {
    setupTables({
      contacts: { selectData: CONTACT },
      sms_suppressions: { selectData: null },
      agent_messages: { selectData: [] },
      tasks: { selectData: [], insert: { data: { id: 321 } } },
      notifications: {},
    });
    const out = await handleCallTask(baseTask());
    expect(out).toBe("sent");

    const bridged = inserted.tasks?.[0] as Record<string, unknown>;
    expect(bridged.type).toBe("call");
    expect(bridged.contact_id).toBe(5);
    expect(bridged.sales_id).toBe(4);
    expect(String(bridged.text)).toContain("Double dial 2/6");

    const notif = inserted.notifications?.[0] as Record<string, unknown>;
    expect(notif.sales_id).toBe(4);
    expect(notif.type).toBe("call_due");
    expect((notif.payload as Record<string, unknown>).task_id).toBe(321);

    expect(statusUpdates.at(-1)).toMatchObject({ status: "sent" });
    expect((statusUpdates.at(-1)!.payload as Record<string, unknown>).task_id).toBe(321);
  });

  it("notifies every active admin for unassigned pool leads", async () => {
    setupTables({
      contacts: { selectData: { ...CONTACT, sales_id: null } },
      sms_suppressions: { selectData: null },
      agent_messages: { selectData: [] },
      tasks: { selectData: [], insert: { data: { id: 500 } } },
      sales: { selectData: [{ id: 1 }, { id: 2 }] },
      notifications: {},
    });
    const out = await handleCallTask(baseTask());
    expect(out).toBe("sent");
    expect((inserted.tasks?.[0] as Record<string, unknown>).sales_id).toBeNull();
    expect(inserted.notifications).toHaveLength(2);
  });

  it("backs off on a transient bridge failure, fails at max attempts", async () => {
    setupTables({
      contacts: { selectData: CONTACT },
      sms_suppressions: { selectData: null },
      agent_messages: { selectData: [] },
      tasks: { selectData: [], insert: { data: null, error: { message: "boom" } } },
    });
    const deferred = await handleCallTask(baseTask());
    expect(deferred).toBe("deferred");
    expect(statusUpdates[0]).toMatchObject({ status: "pending", attempts: 1 });

    statusUpdates.length = 0;
    const failed = await handleCallTask({ ...baseTask(), attempts: 4 });
    expect(failed).toBe("failed");
    expect(statusUpdates[0]).toMatchObject({ status: "failed", attempts: 5 });
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  agentReplyMode,
  isAiPaused,
  pauseAiForContact,
  resumeAiForContact,
} from "./aiPause";

const mockFrom = vi.hoisted(() => vi.fn());
const mockHalt = vi.hoisted(() => vi.fn());

vi.mock("./supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => mockFrom(...args) },
}));

vi.mock("./haltFollowup.ts", () => ({
  haltFollowup: (...args: unknown[]) => mockHalt(...args),
}));

let contactRow: Record<string, unknown> | null = null;
const secrets: Record<string, string> = {};
let contactUpdates: Record<string, unknown>[] = [];
let noteRows: Record<string, unknown>[] = [];

function thenable(value: unknown) {
  const chain: Record<string, unknown> = {};
  const p = Promise.resolve(value);
  for (const m of ["select", "eq", "in", "gte", "limit"]) chain[m] = () => chain;
  chain.single = () => p;
  chain.maybeSingle = () => p;
  chain.then = (...args: Parameters<Promise<unknown>["then"]>) => p.then(...args);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  contactRow = null;
  contactUpdates = [];
  noteRows = [];
  for (const k of Object.keys(secrets)) delete secrets[k];
  mockHalt.mockResolvedValue({ cancelled: 0, contactIds: [] });

  mockFrom.mockImplementation((table: string) => {
    if (table === "contacts") {
      return {
        select: () => thenable({ data: contactRow, error: null }),
        update: (patch: Record<string, unknown>) => {
          contactUpdates.push(patch);
          return thenable({ error: null });
        },
      };
    }
    if (table === "integration_secrets") {
      return {
        select: () => ({
          eq: (_col: string, key: string) =>
            thenable({ data: key in secrets ? { value: secrets[key] } : null }),
        }),
      };
    }
    if (table === "contact_notes") {
      return {
        insert: (row: Record<string, unknown>) => {
          noteRows.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
});

describe("agentReplyMode", () => {
  it("defaults to opener-only when unset", async () => {
    expect(await agentReplyMode()).toBe("opener_only");
  });

  it("returns full only for an explicit 'full'", async () => {
    secrets.AGENT_REPLY_MODE = "full";
    expect(await agentReplyMode()).toBe("full");
  });

  it("treats anything else as opener-only", async () => {
    secrets.AGENT_REPLY_MODE = "FULLL";
    expect(await agentReplyMode()).toBe("opener_only");
  });
});

describe("isAiPaused", () => {
  it("is false when never paused", async () => {
    contactRow = { ai_paused_until: null };
    expect(await isAiPaused(7)).toBe(false);
  });

  it("is true while the deadline is ahead", async () => {
    contactRow = { ai_paused_until: new Date(Date.now() + 60_000).toISOString() };
    expect(await isAiPaused(7)).toBe(true);
  });

  it("self-heals once the deadline passes", async () => {
    contactRow = { ai_paused_until: new Date(Date.now() - 60_000).toISOString() };
    expect(await isAiPaused(7)).toBe(false);
  });

  it("fails open with no contact id", async () => {
    expect(await isAiPaused(null)).toBe(false);
  });
});

describe("pauseAiForContact", () => {
  it("defaults to 24h and halts the chase identity-wide", async () => {
    const until = await pauseAiForContact({ contactId: 7, reason: "human sent an SMS" });

    const hours = (Date.parse(until) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
    expect(contactUpdates[0].ai_paused_until).toBe(until);
    expect(mockHalt).toHaveBeenCalledWith({ contactId: 7, reason: "human_takeover" });
    expect(noteRows).toHaveLength(1);
  });

  it("honors the AI_PAUSE_HOURS secret", async () => {
    secrets.AI_PAUSE_HOURS = "2";
    const until = await pauseAiForContact({ contactId: 7, reason: "test" });
    const hours = (Date.parse(until) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.1);
  });

  it("extends an existing longer pause rather than shortening it", async () => {
    const far = new Date(Date.now() + 72 * 3_600_000).toISOString();
    contactRow = { ai_paused_until: far };
    expect(await pauseAiForContact({ contactId: 7, reason: "second reply" })).toBe(far);
  });

  it("can skip the chase halt", async () => {
    await pauseAiForContact({ contactId: 7, reason: "test", haltChase: false });
    expect(mockHalt).not.toHaveBeenCalled();
  });
});

describe("resumeAiForContact", () => {
  it("clears the deadline", async () => {
    await resumeAiForContact(7);
    expect(contactUpdates[0]).toEqual({ ai_paused_until: null });
  });
});

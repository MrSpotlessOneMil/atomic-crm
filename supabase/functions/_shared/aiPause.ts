// When the AI sales agent must SHUT UP. Two rules, one module.
//
// 1. OPENER-ONLY MODE (owner mandate, 2026-07-21). The AI's job is to start the
//    conversation, not to run it. It sends the opener; the moment the lead
//    replies, a human owns the thread and the agent does not answer. Multi-turn
//    AI conversations read as confusing to leads and are switched off by
//    default. Flip integration_secrets.AGENT_REPLY_MODE to "full" to restore
//    autonomous qualifying + booking — no redeploy needed.
//
// 2. HUMAN TAKEOVER. When a human texts a lead from the OpenPhone app, that ONE
//    conversation becomes human-owned for a while, so no automation fires on top
//    of them. Stored as contacts.ai_paused_until — a deadline, not a boolean, so
//    a forgotten pause self-heals instead of muting that lead forever.
//
// Neither rule touches demo reminders: a booked lead still needs to know when
// the call is. STOP/opt-out is separate and always wins (see haltFollowup).

import { supabaseAdmin } from "./supabaseAdmin.ts";
import { haltFollowup } from "./haltFollowup.ts";

const DEFAULT_PAUSE_HOURS = 24;

async function secret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? null;
}

export type AgentReplyMode = "opener_only" | "full";

/**
 * Should the agent reply to inbound texts at all? Defaults to opener-only:
 * anything other than an explicit "full" keeps the AI quiet after the opener.
 * Fail-safe by design — a missing/typo'd secret means a human answers, which is
 * never worse than a confusing bot thread.
 */
export async function agentReplyMode(): Promise<AgentReplyMode> {
  const v = (await secret("AGENT_REPLY_MODE"))?.trim().toLowerCase();
  return v === "full" ? "full" : "opener_only";
}

async function pauseHours(): Promise<number> {
  const n = Number((await secret("AI_PAUSE_HOURS"))?.trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAUSE_HOURS;
}

/** True when a human currently owns this conversation. Fail-open: on error the AI keeps working. */
export async function isAiPaused(contactId: number | null): Promise<boolean> {
  if (!contactId) return false;
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("ai_paused_until")
    .eq("id", contactId)
    .maybeSingle();
  if (error || !data?.ai_paused_until) return false;
  const until = Date.parse(String(data.ai_paused_until));
  return Number.isFinite(until) && until > Date.now();
}

/**
 * Hand this conversation to a human for `hours` (default AI_PAUSE_HOURS, else 24).
 * Extends an existing pause, never shortens it — two humans replying in a row
 * must not shrink the window. Also halts the automated chase identity-wide, the
 * same teardown an inbound reply triggers: if a human is talking to this lead,
 * no drip should be running underneath them.
 */
export async function pauseAiForContact(opts: {
  contactId: number;
  reason: string;
  hours?: number;
  haltChase?: boolean;
}): Promise<string> {
  const hours = opts.hours ?? (await pauseHours());
  const candidate = new Date(Date.now() + hours * 60 * 60_000);

  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("ai_paused_until")
    .eq("id", opts.contactId)
    .maybeSingle();
  const currentMs = existing?.ai_paused_until
    ? Date.parse(String(existing.ai_paused_until))
    : NaN;
  const until =
    Number.isFinite(currentMs) && currentMs > candidate.getTime()
      ? new Date(currentMs)
      : candidate;

  await supabaseAdmin
    .from("contacts")
    .update({ ai_paused_until: until.toISOString() })
    .eq("id", opts.contactId);

  if (opts.haltChase !== false) {
    await haltFollowup({ contactId: opts.contactId, reason: "human_takeover" });
  }

  try {
    await supabaseAdmin.from("contact_notes").insert({
      contact_id: opts.contactId,
      text: `🙋 Human took over — automation paused until ${until.toISOString()} (${opts.reason}).`,
      date: new Date().toISOString(),
      status: "warm",
    });
  } catch (_e) {
    /* visibility only */
  }

  return until.toISOString();
}

/** Explicitly give the conversation back to the AI. */
export async function resumeAiForContact(contactId: number): Promise<void> {
  await supabaseAdmin
    .from("contacts")
    .update({ ai_paused_until: null })
    .eq("id", contactId);
}

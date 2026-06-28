// Per-SOURCE messaging playbooks.
//
// Every lead already gets a normalized source in lead_inbound (leadSource()):
// instagram | tiktok | facebook | website | referral | inbound | other |
// cold-call | cold-email. This module turns that source into the right FIRST
// TOUCH, so an Instagram magnet-grab isn't messaged like a referral or a cold
// prospect. Cold sources route to the outbound speed-to-lead AUDIT play
// (auditCopy.ts), NOT this warm opt-in opener.
//
// Voice rules (match salesCopy.ts): lowercase, casual, contractions, ONE
// question, never salesy, no "AI". GSM-7 only, <=160 chars. {{first_name}} is
// filled at send time; {{lead_magnet}} is filled at enqueue time.

import { OPENER } from "./salesCopy.ts";

export type LeadSource =
  | "instagram"
  | "tiktok"
  | "facebook"
  | "website"
  | "referral"
  | "inbound"
  | "other"
  | "cold-call"
  | "cold-email";

// Cold sources are worked by the outbound AUDIT play, not the warm opt-in drip.
export const COLD_SOURCES: LeadSource[] = ["cold-call", "cold-email"];

export function isColdSource(source: string): boolean {
  return (COLD_SOURCES as string[]).includes(source);
}

// One tailored opener per warm source. Cold sources are intentionally absent —
// openerForSource() returns null for them. `website` reuses the canonical
// OPENER. Final wording is Dominic's call; these are first-pass.
export const OPENERS_BY_SOURCE: Record<string, string> = {
  instagram:
    "hey {{first_name}}, robin here from robin line - caught you on insta, just sent {{lead_magnet}}. you running a cleaning crew now or getting started?",
  tiktok:
    "hey {{first_name}}, robin from robin line - saw you over on tiktok, just sent {{lead_magnet}}. you got a crew running or just starting out?",
  facebook:
    "hey {{first_name}}, robin here from robin line - came over from facebook, just sent {{lead_magnet}}. you running a cleaning crew now or getting started?",
  website: OPENER,
  referral:
    "hey {{first_name}}, robin here from robin line - you got pointed our way by someone who rates us. you running a cleaning crew now or just getting started?",
  inbound:
    "hey {{first_name}}, robin here from robin line, thanks for reaching out. you running a cleaning crew right now or just getting started?",
  other:
    "hey {{first_name}}, robin here from robin line, thanks for reaching out. you running a cleaning crew right now or just getting started?",
};

// The warm opener for a source, or null for cold sources (use the audit play).
// Unknown/unmapped sources fall back to the canonical OPENER so a lead is never
// left without a first touch.
export function openerForSource(source: string): string | null {
  if (isColdSource(source)) return null;
  return OPENERS_BY_SOURCE[source] ?? OPENER;
}

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

export const SOURCES = [
  "instagram",
  "tiktok",
  "facebook",
  "cold-call",
  "website",
  "cold-email",
  "inbound",
  "referral",
  "other",
];

// Normalize whatever a caller labels a lead ("Meta Ads", "fb", "IG",
// "website-audit"…) to one canonical source. Shared by lead_inbound and the
// enroll_orphans sweep so both agree on what counts as warm.
export function normalizeLeadSource(raw: string): string {
  const p = raw.toLowerCase();
  if (SOURCES.includes(p)) return p;
  if (p.includes("insta") || p === "ig") return "instagram";
  if (p.includes("tik")) return "tiktok";
  if (p.includes("face") || p === "fb" || p.includes("meta")) return "facebook";
  // Lead-magnet website / landing-page opt-ins get their OWN source so they're
  // visible + measurable in the CRM (previously collapsed into "inbound").
  if (p.includes("web") || p.includes("site") || p.includes("land") || p.includes("form")) return "website";
  if (p.includes("cold-email") || p.includes("cold_email") || p.includes("coldemail")) return "cold-email";
  if (p.includes("refer")) return "referral";
  return "inbound";
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

// Leads who requested the free AI AUDIT (the "GET MY AUDIT" form on the lead
// magnet site) get an audit-specific first touch - they asked for a deliverable,
// so the opener acknowledges it instead of pitching the templates.
export const AUDIT_OPENER =
  "hey {{first_name}}, robin here from robin line - got your audit request, putting it together now. quick q so it's accurate: you running a cleaning crew or solo right now?";

const AUDIT_MAGNET_RE = /audit/i;

// The warm opener for a source, or null for cold sources (use the audit play).
// Unknown/unmapped sources fall back to the canonical OPENER so a lead is never
// left without a first touch. Pass the lead magnet so audit requests get the
// audit-specific opener regardless of source.
export function openerForSource(source: string, magnet?: string): string | null {
  if (isColdSource(source)) return null;
  if (magnet && AUDIT_MAGNET_RE.test(magnet)) return AUDIT_OPENER;
  return OPENERS_BY_SOURCE[source] ?? OPENER;
}

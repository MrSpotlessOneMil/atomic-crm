// Lead attribution: WHICH ad / video / offer / magnet / form brought this lead
// in, stored as contacts.attribution (jsonb). Captured at every intake door
// (meta_leads webhook, web_lead browser POSTs, instantly replies) and shown to
// reps (LeadContextCard) + fed to the AI agent so nobody re-asks known info.
//
// PURE module (no supabase / Deno imports) so vitest can run it in node.

// The full set of keys we accept. Anything else in an inbound payload is
// dropped - these values come from the public internet.
export const ATTRIBUTION_KEYS = [
  "platform", // facebook | instagram | tiktok | ...
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "form_name",
  "video_title",
  "offer", // "20% off first month", "14-day free trial"
  "lead_magnet",
  "keyword",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "ttclid",
  "gclid",
  "referrer",
  "landing_path",
  "leadgen_id", // Meta leadgen id (idempotency + audit trail)
  "first_touch_at",
] as const;

const MAX_VALUE_LEN = 300;

// Whitelist + string-coerce an untrusted attribution object.
export function sanitizeAttribution(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of ATTRIBUTION_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim().slice(0, MAX_VALUE_LEN);
    if (s) out[key] = s;
  }
  return out;
}

// First-touch merge: existing keys win, new keys fill the gaps. A repeat opt-in
// must never overwrite the ad that ORIGINALLY brought the lead in.
export function mergeAttribution(
  existing: unknown,
  incoming: Record<string, string>,
): Record<string, string> {
  const base = sanitizeAttribution(existing);
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in base)) base[k] = v;
  }
  return base;
}

// Best-effort offer extraction from ad / campaign / form names, e.g.
// "RL - Cleaning Owners - 20% Off - video 3" -> "20% off",
// "Spring 14-Day Free Trial form" -> "14-day free trial".
export function parseOffer(...names: (string | null | undefined)[]): string | null {
  for (const name of names) {
    if (!name) continue;
    const pct = name.match(/(\d{1,3})\s*%\s*off/i);
    if (pct) return `${pct[1]}% off`;
    const trial = name.match(/(\d{1,3})[\s-]*day[\s-]*(free\s*)?trial/i);
    if (trial) return `${trial[1]}-day free trial`;
    const freeMonth = name.match(/first\s+month\s+free|free\s+first\s+month/i);
    if (freeMonth) return "first month free";
  }
  return null;
}

// One human-readable line for notes / the AI prompt, e.g.
// "facebook ad \"Robot Voice Demo v2\" (campaign Robinline Campaign 1, 20% off)".
export function attributionSummary(attr: Record<string, string> | null | undefined): string | null {
  if (!attr) return null;
  const bits: string[] = [];
  const channel = attr.platform || attr.utm_source;
  if (attr.ad_name) bits.push(`${channel ? channel + " " : ""}ad "${attr.ad_name}"`);
  else if (channel) bits.push(`via ${channel}`);
  const extras: string[] = [];
  if (attr.campaign_name) extras.push(`campaign ${attr.campaign_name}`);
  else if (attr.utm_campaign) extras.push(`campaign ${attr.utm_campaign}`);
  if (attr.offer) extras.push(attr.offer);
  if (attr.lead_magnet) extras.push(`magnet: ${attr.lead_magnet}`);
  if (extras.length) bits.push(`(${extras.join(", ")})`);
  return bits.length ? bits.join(" ") : null;
}

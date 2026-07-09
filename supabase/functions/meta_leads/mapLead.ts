// Pure mapping from a Graph API leadgen object to the lead_inbound payload.
// Kept free of Deno/supabase imports so vitest can run it in node.

import { parseOffer } from "../_shared/attribution.ts";

export interface GraphLead {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  is_organic?: boolean;
  platform?: string; // "fb" | "ig"
  field_data?: { name?: string; values?: unknown[] }[];
}

export function fieldValue(lead: GraphLead, ...names: string[]): string {
  for (const f of lead.field_data ?? []) {
    const n = (f.name ?? "").toLowerCase();
    if (names.some((want) => n === want || n.includes(want))) {
      const v = f.values?.[0];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

export interface InboundPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
  platform: string;
  lead_magnet?: string;
  attribution: Record<string, string>;
}

// null when the lead is unusable (no phone AND no email).
export function leadToInboundPayload(lead: GraphLead, leadgenId: string): InboundPayload | null {
  const fullName = fieldValue(lead, "full_name", "full name", "name");
  const [first, ...rest] = fullName.split(/\s+/);
  const email = fieldValue(lead, "email");
  const phone = fieldValue(lead, "phone_number", "phone");
  const business = fieldValue(lead, "company_name", "business_name", "company", "business");
  if (!email && !phone) return null;

  const platform = lead.platform === "ig" || lead.platform === "instagram" ? "instagram" : "facebook";
  const offer = parseOffer(lead.ad_name, lead.adset_name, lead.campaign_name);
  const attribution: Record<string, string> = { leadgen_id: leadgenId, platform };
  if (lead.ad_id) attribution.ad_id = lead.ad_id;
  if (lead.ad_name) attribution.ad_name = lead.ad_name;
  if (lead.adset_id) attribution.adset_id = lead.adset_id;
  if (lead.adset_name) attribution.adset_name = lead.adset_name;
  if (lead.campaign_id) attribution.campaign_id = lead.campaign_id;
  if (lead.campaign_name) attribution.campaign_name = lead.campaign_name;
  if (lead.form_id) attribution.form_id = lead.form_id;
  if (offer) attribution.offer = offer;
  if (lead.created_time) attribution.first_touch_at = lead.created_time;

  return {
    first_name: first || "there",
    last_name: rest.join(" "),
    email,
    phone,
    business_name: business,
    platform,
    lead_magnet: lead.ad_name ? `the ${platform} ad "${lead.ad_name}"` : undefined,
    attribution,
  };
}

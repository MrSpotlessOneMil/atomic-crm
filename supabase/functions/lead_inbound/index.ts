// lead_inbound — the single entry point for EVERY lead-magnet capture.
//
// Works for any source that can POST an opt-in: ManyChat comment->DM flows AND
// website lead-magnet landing pages (link -> they enter phone+email) AND
// Typeform/GHL/etc AND the meta_leads webhook (Meta Lead Ads). Each POSTs the
// lead's details; we create/locate the CRM contact + deal (stage 'lead'),
// store attribution (which ad/offer/magnet brought them in), and fire the full
// drip via _shared/enrollment.ts: instant speed-to-lead text + email, nurture
// sequences, and the human double-dial call cadence. The AI agent takes over
// on the reply.
//
// Auth: shared secret header X-LEAD-SECRET == LEAD_INBOUND_SECRET.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { toE164 } from "../_shared/quoSales.ts";
import { enrollLeadCadence, ensureOpenDeal } from "../_shared/enrollment.ts";
import { sanitizeAttribution, mergeAttribution } from "../_shared/attribution.ts";
import { normalizeLeadSource } from "../_shared/leadPlaybooks.ts";

type Body = {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  business_name?: string;
  ig_username?: string;
  keyword?: string;
  platform?: string; // instagram / tiktok / facebook
  source?: string; // alias for platform (website forms often send "source")
  lead_magnet?: string; // readable name of the magnet they grabbed
  attribution?: Record<string, unknown>; // which ad/utm/offer brought them (whitelisted)
};

const trim = (s: unknown, max = 200): string =>
  typeof s === "string" ? s.trim().slice(0, max) : "";

async function findContactByPhone(e164: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .contains("phone_jsonb", [{ number: e164 }])
    .limit(1);
  return (data && data[0]?.id) ?? null;
}

async function findContactByEmail(email: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .contains("email_jsonb", [{ email }])
    .limit(1);
  return (data && data[0]?.id) ?? null;
}

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  const expected = Deno.env.get("LEAD_INBOUND_SECRET");
  const provided = req.headers.get("X-LEAD-SECRET");
  if (!expected || provided !== expected) return createErrorResponse(401, "Unauthorized");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  const first_name = trim(body.first_name, 80) || "there";
  const last_name = trim(body.last_name, 80);
  const email = trim(body.email, 200).toLowerCase();
  const e164 = toE164(trim(body.phone, 40));
  const business = trim(body.business_name || body.ig_username, 120);
  const sourceRaw = trim(body.platform || body.source, 40) || "inbound";
  const source = normalizeLeadSource(sourceRaw);
  const magnet = trim(body.lead_magnet, 60);

  // Attribution: whitelist whatever the caller knows (ad ids from meta_leads,
  // utm/click ids from the website, keyword from ManyChat) and make sure the
  // basics are always stamped even when no attribution object was sent.
  const attribution = sanitizeAttribution(body.attribution);
  if (magnet && !attribution.lead_magnet) attribution.lead_magnet = magnet;
  const keyword = trim(body.keyword, 40);
  if (keyword && !attribution.keyword) attribution.keyword = keyword;
  if (!attribution.platform) attribution.platform = source;
  if (!attribution.first_touch_at) attribution.first_touch_at = new Date().toISOString();

  // Need at least one channel to work the lead: phone (SMS funnel) or email
  // (warm email drip). Email-only opt-ins are now captured too.
  if (!e164 && !email) return createErrorResponse(400, "phone or email required");

  // Find or create the contact. Dedupe by phone FIRST, then fall back to email,
  // so a repeat opt-in that arrives on a different channel (or whose phone
  // lookup races) reuses the existing contact instead of spawning a duplicate.
  let contactId: number | null = null;
  if (e164) contactId = await findContactByPhone(e164);
  if (!contactId && email) contactId = await findContactByEmail(email);
  if (contactId) {
    // First-touch attribution wins: existing keys stay, new keys fill gaps.
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("attribution")
      .eq("id", contactId)
      .maybeSingle();
    await supabaseAdmin
      .from("contacts")
      .update({
        last_seen: new Date().toISOString(),
        attribution: mergeAttribution(existing?.attribution, attribution),
      })
      .eq("id", contactId);
  } else {
    const ins = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name,
        last_name,
        email_jsonb: email ? [{ email, type: "Work" }] : null,
        phone_jsonb: e164 ? [{ number: e164, type: "Mobile" }] : null,
        lead_source: source,
        background: `Opted in via ${sourceRaw}${magnet ? ` for ${magnet}` : ""}${keyword ? ` (keyword: ${keyword})` : ""}.`,
        attribution,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ins.error) {
      console.error("[lead_inbound] contact insert failed", ins.error);
      return createErrorResponse(500, "Failed to create lead");
    }
    contactId = ins.data.id;
  }

  // Optional company from the business name / handle.
  let companyId: number | null = null;
  if (business) {
    const { data: existing } = await supabaseAdmin.from("companies").select("id").ilike("name", business).limit(1);
    if (existing && existing[0]) {
      companyId = existing[0].id;
    } else {
      const c = await supabaseAdmin.from("companies").insert({ name: business }).select("id").single();
      if (!c.error) companyId = c.data.id;
    }
    if (companyId) await supabaseAdmin.from("contacts").update({ company_id: companyId }).eq("id", contactId);
  }

  // Find or create an open deal at stage 'lead'.
  const dealId = await ensureOpenDeal({
    contactId: contactId as number,
    name: business || `${first_name} ${last_name}`.trim() || e164 || email,
    source,
    companyId,
  });
  if (dealId === null) return createErrorResponse(500, "Failed to create deal");

  // Full drip: speed-to-lead SMS/email + nurture + double-dial call cadence.
  // All dedupe (identity-wide), the flood cap, and the cold-source skip live in
  // enrollLeadCadence, shared with the enroll_orphans sweep.
  const result = await enrollLeadCadence({
    contactId: contactId as number,
    dealId,
    source,
    magnet,
    e164,
    email,
  });

  return new Response(
    JSON.stringify({ ok: true, contact_id: contactId, deal_id: dealId, enqueued: result.enqueued }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

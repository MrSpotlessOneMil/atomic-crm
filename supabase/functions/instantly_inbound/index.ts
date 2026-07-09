// instantly_inbound — routes a cold-email REPLY (from the Robin Line Instantly
// campaigns) into the CRM funnel so no lead leaks in the inbox.
//
// On a positive/any reply, Instantly fires a webhook here (natively, or via a
// Zapier/Make "new reply" bridge). We find-or-create the contact by email,
// tag lead_source='cold-email', open a deal at stage 'contacted' (they already
// engaged), log the reply as a contact_note + agent_message, and hand the deal
// to the human closer (assignToCloser) with a notification.
//
// Deliberately does NOT fire the SMS nurture cadence: these are warm human
// email replies for the closer to work directly. (Flip ENABLE_SMS_FOLLOWUP if
// you later want to also start the text cadence — phone must be present.)
//
// Auth: shared secret header  X-INSTANTLY-SECRET == INSTANTLY_WEBHOOK_SECRET.
//
// Hard boundary: this is the Robin Line SALES funnel only — nothing to do with
// the robinline-1 product or its customers.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { assignToCloser } from "../_shared/handoff.ts";

const ACTIVE_STAGES = ["lead", "contacted", "demo-booked", "demo-done", "proposal-sent", "in-negociation"];

// Accept the common field names Instantly / a Zapier bridge might send, so the
// same endpoint works regardless of how the reply is forwarded.
type Body = {
  email?: string; lead_email?: string; from_email?: string;
  first_name?: string; firstName?: string;
  last_name?: string; lastName?: string;
  company_name?: string; companyName?: string; company?: string;
  reply_text?: string; reply?: string; text?: string; reply_text_snippet?: string; message?: string;
  subject?: string;
  campaign_name?: string; campaign?: string; campaign_id?: string; campaignId?: string;
  city?: string; metro?: string; // optional, if the bridge passes lead custom vars
};

const trim = (s: unknown, max = 200): string =>
  typeof s === "string" ? s.trim().slice(0, max) : "";

const firstNonEmpty = (...vals: Array<string | undefined>): string => {
  for (const v of vals) { const t = trim(v, 8000); if (t) return t; }
  return "";
};

// Strip the bottom-quoted "On Mon, ... wrote:" trail so the note is just their reply.
const stripQuotedTail = (text: string): string => {
  const markers = [/^On .+wrote:\s*$/m, /^-----Original Message-----/m, /^From: .+$/m, /^>.*$/m];
  let cut = text.length;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut).trim();
};

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  // Accept the shared secret via header OR ?secret= query param — Instantly's
  // webhook may not support custom headers, so the query-param form is the
  // reliable fallback.
  const expected = Deno.env.get("INSTANTLY_WEBHOOK_SECRET");
  const provided =
    req.headers.get("X-INSTANTLY-SECRET") ||
    new URL(req.url).searchParams.get("secret") ||
    "";
  if (!expected || provided !== expected) return createErrorResponse(401, "Unauthorized");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  // ISOLATION GUARD: the Instantly webhook is org-wide, so Spotless campaign
  // replies arrive here too. Only process replies from the Robin Line campaign;
  // ack-and-ignore everything else so nothing pollutes the Robin Line CRM.
  const allowId = (Deno.env.get("INSTANTLY_CAMPAIGN_ID") || "").trim();
  const allowName = (Deno.env.get("INSTANTLY_CAMPAIGN_NAME") || "").trim().toLowerCase();
  if (allowId || allowName) {
    const gotId = trim(body.campaign_id ?? body.campaignId, 80);
    const gotName = trim(body.campaign_name ?? body.campaign, 160).toLowerCase();
    const idMatch = allowId && gotId && gotId === allowId;
    const nameMatch = allowName && gotName && gotName === allowName;
    if (!idMatch && !nameMatch) {
      return new Response(
        JSON.stringify({ ok: true, ignored: "campaign not allow-listed", got: gotId || gotName || "(none)" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }
  }

  const email = firstNonEmpty(body.email, body.lead_email, body.from_email).toLowerCase();
  if (!email || !email.includes("@")) return createErrorResponse(400, "lead email required");

  const first_name = trim(body.first_name ?? body.firstName, 80);
  const last_name = trim(body.last_name ?? body.lastName, 80);
  const business = trim(body.company_name ?? body.companyName ?? body.company, 120);
  const campaign = trim(body.campaign_name ?? body.campaign, 120);
  const replyRaw = firstNonEmpty(body.reply_text, body.reply, body.text, body.reply_text_snippet, body.message);
  const replyText = stripQuotedTail(replyRaw).slice(0, 8000);
  const nowIso = new Date().toISOString();

  // 1) Find-or-create the contact by email.
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id, lead_source, company_id")
    .contains("email_jsonb", [{ email }])
    .limit(1);

  let contactId: number;
  let companyId: number | null = null;
  if (existing && existing[0]) {
    contactId = existing[0].id as number;
    companyId = (existing[0].company_id as number | null) ?? null;
    // Tag the source only if it isn't already set (don't clobber a real prior source).
    const patch: Record<string, unknown> = { last_seen: nowIso };
    if (!existing[0].lead_source) patch.lead_source = "cold-email";
    await supabaseAdmin.from("contacts").update(patch).eq("id", contactId);
  } else {
    const ins = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: first_name || email.split("@")[0],
        last_name,
        email_jsonb: [{ email, type: "Work" }],
        lead_source: "cold-email",
        background: `Replied to Robin Line cold email${campaign ? ` (campaign: ${campaign})` : ""}.`,
        // Keep the campaign queryable, not just prose (see _shared/attribution.ts).
        attribution: campaign ? { campaign_name: campaign, platform: "cold-email", first_touch_at: nowIso } : {},
        first_seen: nowIso,
        last_seen: nowIso,
      })
      .select("id")
      .single();
    if (ins.error) {
      console.error("[instantly_inbound] contact insert failed", ins.error);
      return createErrorResponse(500, "Failed to create lead");
    }
    contactId = ins.data.id;
  }

  // 2) Optional company from the business name.
  if (business && !companyId) {
    const { data: co } = await supabaseAdmin.from("companies").select("id").ilike("name", business).limit(1);
    if (co && co[0]) companyId = co[0].id;
    else {
      const c = await supabaseAdmin.from("companies").insert({ name: business }).select("id").single();
      if (!c.error) companyId = c.data.id;
    }
    if (companyId) await supabaseAdmin.from("contacts").update({ company_id: companyId }).eq("id", contactId);
  }

  // 3) Find-or-create an open deal. A reply means they're engaged -> 'contacted'.
  let dealId: number | null = null;
  const { data: openDeal } = await supabaseAdmin
    .from("deals")
    .select("id")
    .contains("contact_ids", [contactId])
    .in("stage", ACTIVE_STAGES)
    .limit(1);
  if (openDeal && openDeal[0]) {
    dealId = openDeal[0].id;
    await supabaseAdmin.from("deals").update({ updated_at: nowIso }).eq("id", dealId);
  } else {
    const d = await supabaseAdmin
      .from("deals")
      .insert({
        name: business || `${first_name} ${last_name}`.trim() || email,
        stage: "contacted",
        category: "cold-email",
        contact_ids: [contactId],
        company_id: companyId,
      })
      .select("id")
      .single();
    if (d.error) {
      console.error("[instantly_inbound] deal insert failed", d.error);
      return createErrorResponse(500, "Failed to create deal");
    }
    dealId = d.data.id;
  }

  // 4) Log the reply on the timeline + machine transcript.
  const noteText = `📧 Cold-email reply${campaign ? ` (${campaign})` : ""}:\n\n${replyText || "(no body captured)"}`;
  await supabaseAdmin.from("contact_notes").insert({
    contact_id: contactId, text: noteText, date: nowIso, status: "warm",
  });
  await supabaseAdmin.from("agent_messages").insert({
    contact_id: contactId, deal_id: dealId, direction: "inbound", body: replyText || "(cold-email reply)",
  });

  // 5) Hand to the human closer (assigns deal + notifies). These are warm replies.
  await assignToCloser({
    dealId,
    contactId,
    reason: "cold-email reply",
    summary: (replyText || "Cold-email reply").slice(0, 140),
  });

  return new Response(
    JSON.stringify({ ok: true, contact_id: contactId, deal_id: dealId }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

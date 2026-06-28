// lead_inbound — the single entry point for EVERY lead-magnet capture.
//
// Works for any source that can POST an opt-in: ManyChat comment->DM flows AND
// website lead-magnet landing pages (link -> they enter phone+email) AND
// Typeform/GHL/etc. Each POSTs the lead's details; we create/locate the CRM
// contact + deal (stage 'lead') and fire the instant speed-to-lead text + the
// nurture cadence. The AI agent takes over on the reply.
//
// Auth: shared secret header X-LEAD-SECRET == LEAD_INBOUND_SECRET.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { toE164, salesSendsPaused } from "../_shared/quoSales.ts";
import { OPENER, NURTURE, EMAIL_OPENER, EMAIL_NURTURE, render } from "../_shared/salesCopy.ts";

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
};

const ACTIVE_STAGES = ["lead", "contacted", "demo-booked", "demo-done", "proposal-sent", "in-negociation"];
const SOURCES = ["instagram", "tiktok", "facebook", "cold-call", "inbound", "referral", "other"];

const trim = (s: unknown, max = 200): string =>
  typeof s === "string" ? s.trim().slice(0, max) : "";

const repName = () => Deno.env.get("SALES_AGENT_NAME") || "Robin";

function leadSource(raw: string): string {
  const p = raw.toLowerCase();
  if (SOURCES.includes(p)) return p;
  if (p.includes("insta") || p === "ig") return "instagram";
  if (p.includes("tik")) return "tiktok";
  if (p.includes("face") || p === "fb" || p.includes("meta")) return "facebook";
  if (p.includes("web") || p.includes("site") || p.includes("land") || p.includes("form")) return "inbound";
  if (p.includes("refer")) return "referral";
  return "inbound";
}

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
  const source = leadSource(sourceRaw);
  const magnet = trim(body.lead_magnet, 60);

  // Need at least one channel to work the lead: phone (SMS funnel) or email
  // (warm email drip). Email-only opt-ins are now captured too.
  if (!e164 && !email) return createErrorResponse(400, "phone or email required");

  // Find or create the contact. Dedupe by phone when present (E.164-normalized),
  // else by email.
  let contactId = e164 ? await findContactByPhone(e164) : await findContactByEmail(email);
  if (contactId) {
    await supabaseAdmin
      .from("contacts")
      .update({ last_seen: new Date().toISOString() })
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
        background: `Opted in via ${sourceRaw}${magnet ? ` for ${magnet}` : ""}${body.keyword ? ` (keyword: ${trim(body.keyword, 40)})` : ""}.`,
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
  let dealId: number | null = null;
  const { data: openDeal } = await supabaseAdmin
    .from("deals")
    .select("id")
    .contains("contact_ids", [contactId])
    .in("stage", ACTIVE_STAGES)
    .limit(1);
  if (openDeal && openDeal[0]) {
    dealId = openDeal[0].id;
  } else {
    const d = await supabaseAdmin
      .from("deals")
      .insert({
        name: business || `${first_name} ${last_name}`.trim() || e164 || email,
        stage: "lead",
        category: source,
        contact_ids: [contactId],
        company_id: companyId,
      })
      .select("id")
      .single();
    if (d.error) {
      console.error("[lead_inbound] deal insert failed", d.error);
      return createErrorResponse(500, "Failed to create deal");
    }
    dealId = d.data.id;
  }

  // Enqueue speed-to-lead + nurture, but only if nothing's pending already
  // (prevents double-texting on a repeat opt-in / multiple magnets).
  const { data: pending } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("id")
    .eq("contact_id", contactId)
    .eq("status", "pending")
    .limit(1);

  // Abuse cap: if a flood of tasks appeared in the last hour (e.g. someone
  // hammering the public form), record the lead but stop auto-texting so the
  // number can't be used to mass-blast SMS.
  const { count: recentTasks } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("*", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  const flooded = (recentTasks ?? 0) > 60;
  if (flooded) console.warn("[lead_inbound] flood cap hit — skipping auto-text", { recentTasks });

  // Global pause: log the lead into the CRM (done above) but send no auto-texts.
  const paused = await salesSendsPaused();
  if (paused) console.info("[lead_inbound] sends paused — logged lead, no auto-text");

  let enqueued = 0;
  if (!paused && !flooded && (!pending || pending.length === 0)) {
    // {{first_name}} stays for send time; {{lead_magnet}} names what they grabbed.
    const vars = { rep_name: repName(), lead_magnet: magnet || "your free templates" };
    const now = Date.now();
    const rows: Record<string, unknown>[] = [];
    // SMS cadence — only when we have a phone.
    if (e164) {
      rows.push({
        task_type: "speed_to_lead_sms",
        contact_id: contactId,
        deal_id: dealId,
        payload: { content: render(OPENER, vars), key: "opener" },
        run_at: new Date(now).toISOString(),
      });
      for (const s of NURTURE) {
        rows.push({
          task_type: "nurture_sms",
          contact_id: contactId,
          deal_id: dealId,
          payload: { content: render(s.template, vars), key: s.key },
          run_at: new Date(now + s.offsetMinutes * 60_000).toISOString(),
        });
      }
    }
    // WARM email drip — whenever we have an email (runs alongside SMS, or alone
    // for email-only opt-ins). Sent from the closer's Gmail by dispatch_tasks.
    if (email) {
      rows.push({
        task_type: "speed_to_lead_email",
        contact_id: contactId,
        deal_id: dealId,
        payload: { subject: EMAIL_OPENER.subject, content: render(EMAIL_OPENER.body, vars), key: EMAIL_OPENER.key },
        run_at: new Date(now + EMAIL_OPENER.offsetMinutes * 60_000).toISOString(),
      });
      for (const s of EMAIL_NURTURE) {
        rows.push({
          task_type: "nurture_email",
          contact_id: contactId,
          deal_id: dealId,
          payload: { subject: s.subject, content: render(s.body, vars), key: s.key },
          run_at: new Date(now + s.offsetMinutes * 60_000).toISOString(),
        });
      }
    }
    if (rows.length) {
      const r = await supabaseAdmin.from("scheduled_tasks").insert(rows);
      if (r.error) console.error("[lead_inbound] enqueue failed", r.error);
      else enqueued = rows.length;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, contact_id: contactId, deal_id: dealId, enqueued }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

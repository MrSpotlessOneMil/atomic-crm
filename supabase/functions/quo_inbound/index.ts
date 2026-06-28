// quo_inbound — receives inbound SMS to the dedicated sales number and routes
// it to the AI sales agent.
//
// HARD scoping rule: we ONLY act on messages whose "to" is our
// SALES_AGENT_QUO_NUMBER. Anything else is ignored. The OpenPhone webhook is
// registered against that one number (never resourceIds ["*"]) — this is what
// prevents the cross-tenant SMS bleed we hit before.
//
// Auth: OpenPhone HMAC signature (openphone-signature header). GOTCHA: OpenPhone
// signs with the BASE64-DECODED webhook key, over `${timestamp}.${rawBody}`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { getSalesNumber, toE164, salesSendsPaused } from "../_shared/quoSales.ts";
import { runSalesAgentTurn } from "../_shared/salesAgent.ts";
import { enrichFromMessage } from "../_shared/enrich.ts";

const STOP_RE = /^\s*(stop|stopall|unsubscribe|end|quit|cancel|optout|opt out)\s*$/i;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

async function verifySignature(rawBody: string, header: string | null, b64Secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(";"); // hmac;1;<timestamp>;<base64sig>
  if (parts.length < 4) return false;
  const timestamp = parts[2];
  const provided = parts[3];
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      b64ToBytes(b64Secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
    const computed = bytesToB64(sig);
    if (computed.length !== provided.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ provided.charCodeAt(i);
    return diff === 0;
  } catch (e) {
    console.error("[quo_inbound] verify error", e);
    return false;
  }
}

const ok = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const firstStr = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""));

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  const secret = Deno.env.get("SALES_QUO_WEBHOOK_SECRET");
  if (!secret) return createErrorResponse(503, "Inbound webhook not configured");

  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("openphone-signature"), secret))) {
    return createErrorResponse(401, "Bad signature");
  }

  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  // Only inbound texts. Everything else (delivery receipts, calls, pings) -> ack.
  if (evt?.type !== "message.received") return ok();

  const msg = evt?.data?.object ?? {};
  const from = toE164(firstStr(msg.from));
  const to = toE164(firstStr(msg.to));
  const text = String(msg.body ?? msg.text ?? "").trim();
  if (!from || !text) return ok();

  // SCOPE: only act on texts to our dedicated sales line.
  const sales = toE164((await getSalesNumber()) ?? "");
  if (!sales || to !== sales) {
    console.warn("[quo_inbound] ignoring message not addressed to sales number", { to });
    return ok();
  }

  // Find or create the contact for this sender.
  let contactId: number | null = null;
  let leadLabel = `Lead ${from}`;
  {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .contains("phone_jsonb", [{ number: from }])
      .limit(1);
    contactId = (data && data[0]?.id) ?? null;
  }
  if (!contactId) {
    // Enrich from the first message (fetch any website they texted) so we have a
    // real name + company instead of "Lead".
    const id = await enrichFromMessage(text);
    leadLabel = id.company_name || `${id.first_name} ${id.last_name}`.trim() || leadLabel;

    let companyId: number | null = null;
    if (id.company_name) {
      const { data: existing } = await supabaseAdmin.from("companies").select("id").ilike("name", id.company_name).limit(1);
      if (existing && existing[0]) companyId = existing[0].id;
      else {
        const c = await supabaseAdmin.from("companies").insert({ name: id.company_name }).select("id").single();
        if (!c.error) companyId = c.data.id;
      }
    }

    const ins = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: id.first_name || null,
        last_name: id.last_name || null,
        company_id: companyId,
        email_jsonb: id.email ? [{ email: id.email, type: "Work" }] : null,
        phone_jsonb: [{ number: from, type: "Mobile" }],
        lead_source: "inbound",
        background: `Texted the Robin Line sales line.${id.notes ? " " + id.notes : ""}`,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ins.error) {
      console.error("[quo_inbound] contact insert failed", ins.error);
      return ok();
    }
    contactId = ins.data.id;
  } else {
    await supabaseAdmin.from("contacts").update({ last_seen: new Date().toISOString() }).eq("id", contactId);
  }

  // Ensure an open deal exists (cold inbound may not have one).
  let dealId: number | null = null;
  {
    const { data } = await supabaseAdmin
      .from("deals")
      .select("id")
      .contains("contact_ids", [contactId])
      .in("stage", ["lead", "contacted", "demo-booked", "demo-done", "proposal-sent", "in-negociation"])
      .limit(1);
    dealId = (data && data[0]?.id) ?? null;
  }
  if (!dealId) {
    const d = await supabaseAdmin
      .from("deals")
      .insert({ name: leadLabel, stage: "lead", category: "inbound", contact_ids: [contactId] })
      .select("id")
      .single();
    if (!d.error) dealId = d.data.id;
  }

  // Record the inbound message (machine transcript + human timeline).
  await supabaseAdmin.from("agent_messages").insert({ contact_id: contactId, deal_id: dealId, direction: "inbound", body: text });
  try {
    await supabaseAdmin.from("contact_notes").insert({
      contact_id: contactId,
      text: `📥 Inbound text from ${from}:\n${text}`,
      date: new Date().toISOString(),
      status: "warm",
    });
  } catch (_e) { /* visibility only */ }

  // STOP -> suppress + cancel pending, acknowledge once, do NOT invoke the agent.
  if (STOP_RE.test(text)) {
    await supabaseAdmin.from("sms_suppressions").upsert({ phone: from, reason: "stop", contact_id: contactId }, { onConflict: "phone" });
    await supabaseAdmin
      .from("scheduled_tasks")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("contact_id", contactId)
      .eq("status", "pending");
    return ok();
  }

  // They replied -> stop the nurture chase, then let the agent respond.
  await supabaseAdmin
    .from("scheduled_tasks")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("contact_id", contactId)
    .eq("status", "pending")
    .in("task_type", ["nurture_sms", "speed_to_lead_sms"]);

  // Global pause: the inbound text is logged above (CRM timeline + transcript),
  // but the AI agent does NOT auto-reply. A human handles it from OpenPhone/CRM.
  if (await salesSendsPaused()) {
    console.info("[quo_inbound] sends paused — logged inbound, no AI reply");
    return ok();
  }

  try {
    await runSalesAgentTurn(contactId);
  } catch (e) {
    console.error("[quo_inbound] agent turn failed", e);
  }

  return ok();
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

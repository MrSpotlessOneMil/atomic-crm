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
import {
  getSalesNumber,
  toE164,
  salesSendsPaused,
  logSms,
  isOurOutboundMessage,
} from "../_shared/quoSales.ts";
import { runSalesAgentTurn } from "../_shared/salesAgent.ts";
import { enrichFromMessage } from "../_shared/enrich.ts";
import {
  haltFollowup,
  notifyLeadReplied,
  phoneVariants,
} from "../_shared/haltFollowup.ts";
import { agentReplyMode, isAiPaused, pauseAiForContact } from "../_shared/aiPause.ts";
import { assignToCloser } from "../_shared/handoff.ts";

// Opt-out matcher. Deliberately wider than the carrier keywords: real people
// write "Stop.", "please stop", "stop texting me", "no more texts" - all of
// which the carrier may already honor on its side, so if we don't suppress too,
// every later send fails with "user has opted out". ALTO is the standard
// Spanish opt-out. Trailing punctuation is tolerated; anything with more words
// than an opt-out phrase is treated as a real reply (the agent handles it).
const STOP_RE =
  /^\s*(please\s+)?(stop|stopall|stop\s+all|unsubscribe|end|quit|cancel|optout|opt[ -]?out|alto|stop\s+text(ing)?( me)?|stop\s+messaging( me)?|no\s+more\s+(texts|messages)|remove\s+me|do\s+not\s+text( me)?|don'?t\s+text( me)?( again)?)\s*[.!?]*\s*$/i;

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

async function verifySignature(
  rawBody: string,
  header: string | null,
  b64Secret: string,
): Promise<boolean> {
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
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    );
    const computed = bytesToB64(sig);
    if (computed.length !== provided.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++)
      diff |= computed.charCodeAt(i) ^ provided.charCodeAt(i);
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

const firstStr = (v: unknown): string =>
  Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");

/** First contact whose stored phone matches, trying every stored format. */
async function contactIdForPhone(phone: string): Promise<number | null> {
  for (const variant of phoneVariants(phone)) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .contains("phone_jsonb", [{ number: variant }])
      .limit(1);
    if (data && data[0]?.id) return data[0].id;
  }
  return null;
}

/**
 * A text went OUT on the sales line. Ours (AI agent / dispatcher) -> nothing to
 * do, it was logged at send time. Not ours -> a human typed it in the OpenPhone
 * app, so hand them the conversation and pause automation for that lead.
 */
async function handleOutboundMessage(evt: {
  data?: { object?: Record<string, unknown> };
}): Promise<void> {
  const msg = evt?.data?.object ?? {};
  const from = toE164(firstStr(msg.from));
  const to = toE164(firstStr(msg.to));
  const body = String(msg.body ?? msg.text ?? "").trim();
  if (!from || !to || !body) return;

  // Scope: only the dedicated sales line, same rule as inbound.
  const sales = toE164((await getSalesNumber()) ?? "");
  if (!sales || from !== sales) return;

  const contactId = await contactIdForPhone(to);
  if (!contactId) return; // no CRM record -> nothing to pause

  const openphoneMessageId = typeof msg.id === "string" ? msg.id : null;
  if (await isOurOutboundMessage({ openphoneMessageId, contactId, body })) return;

  const until = await pauseAiForContact({
    contactId,
    reason: "human sent an SMS from OpenPhone",
  });
  console.info("[quo_inbound] human takeover — automation paused", {
    contactId,
    until,
  });

  // Keep the transcript honest: the agent must see what the human said, so if
  // the pause lapses it never repeats or contradicts them.
  await supabaseAdmin.from("agent_messages").insert({
    contact_id: contactId,
    direction: "outbound",
    body: `[sent by a human] ${body}`,
  });
  await logSms({
    contactId,
    direction: "outbound",
    fromNumber: from,
    toNumber: to,
    body,
    phoneNumberId: (msg.phoneNumberId as string) ?? null,
    openphoneMessageId,
  });
}

const handle = async (req: Request) => {
  if (req.method !== "POST")
    return createErrorResponse(405, "Method Not Allowed");

  const secret = Deno.env.get("SALES_QUO_WEBHOOK_SECRET");
  if (!secret)
    return createErrorResponse(503, "Inbound webhook not configured");

  const raw = await req.text();
  if (
    !(await verifySignature(
      raw,
      req.headers.get("openphone-signature"),
      secret,
    ))
  ) {
    return createErrorResponse(401, "Bad signature");
  }

  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  // Outbound on the sales line: if a HUMAN sent it from the OpenPhone app they
  // have taken the conversation over, so pause automation for that one lead.
  if (evt?.type === "message.delivered" || evt?.type === "message.sent") {
    await handleOutboundMessage(evt);
    return ok();
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
    console.warn(
      "[quo_inbound] ignoring message not addressed to sales number",
      { to },
    );
    return ok();
  }

  // Find or create the contact for this sender. Try every stored phone format
  // (E.164 / bare digits) so a pre-backfill contact still matches instead of
  // spawning a duplicate whose reply would cancel nothing on the original.
  let contactId: number | null = null;
  let leadLabel = `Lead ${from}`;
  for (const variant of phoneVariants(from)) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .contains("phone_jsonb", [{ number: variant }])
      .limit(1);
    if (data && data[0]?.id) {
      contactId = data[0].id;
      break;
    }
  }
  if (!contactId) {
    // Enrich from the first message (fetch any website they texted) so we have a
    // real name + company instead of "Lead".
    const id = await enrichFromMessage(text);
    leadLabel =
      id.company_name || `${id.first_name} ${id.last_name}`.trim() || leadLabel;

    let companyId: number | null = null;
    if (id.company_name) {
      const { data: existing } = await supabaseAdmin
        .from("companies")
        .select("id")
        .ilike("name", id.company_name)
        .limit(1);
      if (existing && existing[0]) companyId = existing[0].id;
      else {
        const c = await supabaseAdmin
          .from("companies")
          .insert({ name: id.company_name })
          .select("id")
          .single();
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
    await supabaseAdmin
      .from("contacts")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", contactId);
  }

  // Ensure an open deal exists (cold inbound may not have one).
  let dealId: number | null = null;
  {
    const { data } = await supabaseAdmin
      .from("deals")
      .select("id")
      .contains("contact_ids", [contactId])
      .in("stage", [
        "lead",
        "contacted",
        "demo-booked",
        "demo-done",
        "proposal-sent",
        "in-negociation",
      ])
      .limit(1);
    dealId = (data && data[0]?.id) ?? null;
  }
  if (!dealId) {
    const d = await supabaseAdmin
      .from("deals")
      .insert({
        name: leadLabel,
        stage: "lead",
        category: "inbound",
        contact_ids: [contactId],
      })
      .select("id")
      .single();
    if (!d.error) dealId = d.data.id;
  }

  // Record the inbound message (machine transcript + human timeline).
  await supabaseAdmin.from("agent_messages").insert({
    contact_id: contactId,
    deal_id: dealId,
    direction: "inbound",
    body: text,
  });
  // Persist to the SMS analytics log (best-effort).
  if (contactId) {
    await logSms({
      contactId,
      direction: "inbound",
      fromNumber: from,
      toNumber: to,
      body: text,
      phoneNumberId: (msg.phoneNumberId as string) ?? null,
      openphoneMessageId: (msg.id as string) ?? null,
    });
  }
  try {
    await supabaseAdmin.from("contact_notes").insert({
      contact_id: contactId,
      text: `📥 Inbound text from ${from}:\n${text}`,
      date: new Date().toISOString(),
      status: "warm",
    });
  } catch (_e) {
    /* visibility only */
  }

  // STOP -> suppress + halt EVERYTHING (reminders included), identity-wide.
  // Also suppress their emails: "stop" to the same brand means stop, not
  // "keep emailing me". Acknowledge silently, never invoke the agent.
  if (STOP_RE.test(text)) {
    await supabaseAdmin
      .from("sms_suppressions")
      .upsert(
        { phone: from, reason: "stop", contact_id: contactId },
        { onConflict: "phone" },
      );
    // Halt first (returns the full identity: this contact + every duplicate),
    // then suppress the emails of EVERY one of those records — a stop keyed to
    // just one duplicate would leave the other row's email drip legal-but-live.
    const halted = await haltFollowup({
      contactId,
      reason: "stop",
      scope: "all",
    });
    const { data: idRows } = await supabaseAdmin
      .from("contacts")
      .select("id, email_jsonb")
      .in("id", halted.contactIds);
    for (const row of idRows ?? []) {
      const ej = Array.isArray((row as { email_jsonb: unknown }).email_jsonb)
        ? (row as { email_jsonb: unknown[] }).email_jsonb
        : [];
      for (const e of ej) {
        const em =
          e && typeof e === "object" ? (e as Record<string, unknown>).email : e;
        if (typeof em === "string" && em.includes("@")) {
          await supabaseAdmin.from("email_suppressions").upsert(
            {
              email: em.trim().toLowerCase(),
              reason: "sms_stop",
              contact_id: (row as { id: number }).id,
            },
            { onConflict: "email" },
          );
        }
      }
    }
    return ok();
  }

  // They replied -> ALL automated follow-up stops (texts, drip emails, and the
  // double-dial cadence - the live conversation owns them now), identity-wide.
  // Then notify the human (5-minute-response SLA) and let the agent respond.
  await haltFollowup({ contactId, reason: "sms_reply" });
  await notifyLeadReplied({ contactId, channel: "sms", preview: text });

  // Global pause: the inbound text is logged above (CRM timeline + transcript),
  // but the AI agent does NOT auto-reply. The lead_replied notification above
  // means a human still hears about it instead of the reply sitting unanswered.
  if (await salesSendsPaused()) {
    console.info("[quo_inbound] sends paused — logged inbound, no AI reply");
    return ok();
  }

  // A human is already mid-conversation with this lead — never answer over them.
  if (await isAiPaused(contactId)) {
    console.info("[quo_inbound] contact is human-owned — no AI reply", { contactId });
    return ok();
  }

  // OPENER-ONLY (default): the AI starts conversations, humans run them. The
  // reply is logged, the chase is already halted, and the closer has been
  // notified above — so hand them the deal and stay quiet.
  if ((await agentReplyMode()) === "opener_only") {
    console.info("[quo_inbound] opener-only mode — handing the reply to a human", { contactId });
    await assignToCloser({
      dealId,
      contactId,
      reason: "lead_replied_opener_only",
      summary: `Lead replied to the opener: "${text.slice(0, 200)}"`,
    });
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

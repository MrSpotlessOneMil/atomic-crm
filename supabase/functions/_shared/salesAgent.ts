// The AI sales agent — qualifies inbound leads over SMS and books them onto a
// demo. Runs the standard Claude tool-use loop (Sonnet 4.6, per the approved
// plan): call -> if stop_reason "tool_use", execute tools + feed results back ->
// repeat until a text reply, then send that reply from the sales number.
//
// Called by quo_inbound (after it stores the inbound message). Reuses the
// CRM's contacts/deals as the source of truth. Touches NOTHING in robinline-1.

import { supabaseAdmin } from "./supabaseAdmin.ts";
import { sendSalesSms, toE164 } from "./quoSales.ts";
import { isCleanSms } from "./salesCopy.ts";
import { assignToCloser } from "./handoff.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 600;
const MAX_TOOL_TURNS = 6;

const ACTIVE_STAGES = ["lead", "contacted", "demo-booked", "demo-done", "proposal-sent", "in-negociation"];

async function getAnthropicKey(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "ANTHROPIC_API_KEY")
    .single();
  return data?.value ?? Deno.env.get("ANTHROPIC_API_KEY") ?? null;
}

async function getSecret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

const agentName = () => Deno.env.get("SALES_AGENT_NAME") || "Robin";

interface ContactRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  phone_jsonb: unknown;
  lead_source: string | null;
  company_id: number | null;
}

interface DealRow {
  id: number;
  stage: string;
  pain_point: string | null;
  owner_type: string | null;
  description: string | null;
}

function firstPhone(c: ContactRow): string | null {
  const pj = c.phone_jsonb;
  if (Array.isArray(pj)) {
    for (const e of pj) {
      if (typeof e === "string" && e.trim()) return e;
      if (e && typeof e === "object") {
        const n = (e as Record<string, unknown>).number;
        if (typeof n === "string" && n.trim()) return n;
      }
    }
  }
  return null;
}

async function getOpenDeal(contactId: number): Promise<DealRow | null> {
  const { data } = await supabaseAdmin
    .from("deals")
    .select("id, stage, pain_point, owner_type, description")
    .contains("contact_ids", [contactId])
    .in("stage", ACTIVE_STAGES)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data && data[0]) ?? null;
}

async function loadHistory(
  contactId: number,
  limit = 20,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data } = await supabaseAdmin
    .from("agent_messages")
    .select("direction, body, created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data ?? []).map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.body as string,
  }));
}

function systemPrompt(contact: ContactRow, deal: DealRow | null, companyName: string | null): string {
  const known = [
    contact.first_name ? `name=${contact.first_name}` : "",
    companyName ? `company=${companyName}` : "",
    contact.lead_source ? `source=${contact.lead_source}` : "",
    deal ? `stage=${deal.stage}` : "",
    deal?.owner_type ? `owner_type=${deal.owner_type}` : "",
    deal?.pain_point ? `pain=${deal.pain_point}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  // Stable prefix (prompt-cached). Known-facts line appended after the cache
  // breakpoint by the caller.
  return `You are ${agentName()}, a friendly human-sounding SDR who texts on behalf of Robin Line.
Robin Line is the AI operating system for cleaning companies: it answers every lead in seconds by text and voice, books and quotes jobs, dispatches crews, collects payment, and wins back old customers - so the owner stops losing jobs to slow replies and stops paying a VA to do it.
You are texting a cleaning-company OWNER who just downloaded our free outreach templates. Your ONE job: qualify them and book a 15-minute demo. You do NOT run the demo or talk price beyond the published plans.

STYLE (this is SMS):
- One short text per reply. Under 160 characters. Plain text only - no emoji, no em-dash, no curly quotes (they break SMS).
- Sound like a real person, warm and casual. One question at a time. Never a wall of text.
- Mirror their words. Keep it moving toward a booked time.
- NAMES: if you do NOT know their first name, greet warmly WITHOUT a name ("Hey!" / "Hey there") - NEVER call them "Lead". Get their name + business early; the moment you learn either, call save_identity to save it to the CRM.

PLAYBOOK:
- Qualify naturally across the chat: are they the owner/decision-maker; residential / commercial / both; roughly how big (solo, few cleaners, bigger); are they already getting leads (running Meta/Google ads or steady jobs); what's the real headache (missed leads, slow follow-up, scheduling chaos, no-shows, paying a VA); can they invest about $599+/mo.
- QUALIFY BEFORE YOU BOOK - this is the most important thing. Robin Line fits established operators who have real lead flow and can afford it. If they ARE a fit, drive to the demo: call send_booking_link and put the link in your text, confirm a day if they name one. If they are clearly NOT a fit yet (just starting, no leads, can't do $599, not the owner), do NOT book a demo - be warm, tell them what to fix first, offer to keep them posted, and call qualify_lead + log_note. Booking tire-kickers who then ghost is exactly what we are trying to stop.
- Objections: "too busy" -> 15 min, we do the setup; "I have a system" -> Robin replies in seconds 24/7, most do not; "how much" -> Starter $599, Growth $1,299, Scale $2,499/mo, less than a VA - then steer to the demo to see ROI. Do NOT negotiate or discount.
- Call tools to record what you learn (qualify_lead), move the deal (advance_stage), and leave a note (log_note).
- If they say stop/unsubscribe/opt out, call opt_out and send nothing else.
- Hand off to a human (handoff_to_human) if: they are angry, it is a real pricing negotiation, they ask something you cannot answer, or they are clearly a big multi-location operator who wants a person.

Use the tools to do the work; your final text is the SMS that gets sent to them. If a tool already says everything (e.g. opt_out), reply with an empty message.
Known so far: ${known || "nothing yet"}.`;
}

function toolDefs() {
  return [
    {
      name: "save_identity",
      description:
        "Save the lead's real name and/or company to the CRM the moment you learn them (from their reply, or a website they sent). Call this EARLY so we stop calling them 'Lead'.",
      input_schema: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          company_name: { type: "string" },
        },
      },
    },
    {
      name: "qualify_lead",
      description:
        "Record what you've learned about the lead. Call whenever you learn any of these. All fields optional.",
      input_schema: {
        type: "object",
        properties: {
          vertical: { type: "string", enum: ["residential", "commercial", "both", "unknown"] },
          team_size: { type: "string", description: "e.g. solo, 2-5, 6-15, 15+ , unknown" },
          pain_point: { type: "string", description: "their main headache in a few words" },
          owner_type: { type: "string", enum: ["owner", "manager", "other", "unknown"] },
        },
      },
    },
    {
      name: "send_booking_link",
      description:
        "Get the Calendly demo link and move the deal to 'contacted'. Call this when you're ready to book them; then include the returned url in your text.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "advance_stage",
      description: "Move the deal to a pipeline stage.",
      input_schema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ["lead", "contacted", "demo-booked", "lost"] },
        },
        required: ["stage"],
      },
    },
    {
      name: "log_note",
      description: "Leave a short note on the lead's timeline for the human AE.",
      input_schema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    {
      name: "schedule_followup",
      description:
        "Schedule a single follow-up text in the future (e.g. when they say 'text me Monday').",
      input_schema: {
        type: "object",
        properties: {
          hours: { type: "number", description: "hours from now" },
          message: { type: "string", description: "the text to send, under 160 chars" },
        },
        required: ["hours", "message"],
      },
    },
    {
      name: "opt_out",
      description: "The lead asked to stop. Suppress all future texts.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "handoff_to_human",
      description:
        "Escalate to a human AE. Use for anger, real price negotiation, questions you can't answer, or big multi-location operators.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string" },
          summary: { type: "string", description: "1-2 line brief: who they are, why now, objections" },
        },
        required: ["reason", "summary"],
      },
    },
  ];
}

// ---- tool executors -------------------------------------------------------

async function cancelPendingTasks(contactId: number) {
  await supabaseAdmin
    .from("scheduled_tasks")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("contact_id", contactId)
    .eq("status", "pending");
}

async function execTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { contact: ContactRow; deal: DealRow | null; phone: string },
): Promise<string> {
  switch (name) {
    case "save_identity": {
      const patch: Record<string, unknown> = {};
      if (input.first_name) patch.first_name = String(input.first_name).slice(0, 80);
      if (input.last_name) patch.last_name = String(input.last_name).slice(0, 80);
      if (Object.keys(patch).length) {
        await supabaseAdmin.from("contacts").update(patch).eq("id", ctx.contact.id);
      }
      if (input.company_name) {
        const cn = String(input.company_name).slice(0, 120);
        const { data: existing } = await supabaseAdmin.from("companies").select("id").ilike("name", cn).limit(1);
        let companyId = existing?.[0]?.id ?? null;
        if (!companyId) {
          const c = await supabaseAdmin.from("companies").insert({ name: cn }).select("id").single();
          if (!c.error) companyId = c.data.id;
        }
        if (companyId) await supabaseAdmin.from("contacts").update({ company_id: companyId }).eq("id", ctx.contact.id);
      }
      return "saved";
    }
    case "qualify_lead": {
      if (!ctx.deal) return "no open deal";
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.pain_point) patch.pain_point = String(input.pain_point).slice(0, 300);
      if (input.owner_type) patch.owner_type = String(input.owner_type);
      const extra = [
        input.vertical ? `vertical=${input.vertical}` : "",
        input.team_size ? `team=${input.team_size}` : "",
      ].filter(Boolean).join(", ");
      if (extra) {
        patch.description = `${ctx.deal.description ? ctx.deal.description + "\n" : ""}${extra}`.slice(0, 1000);
      }
      await supabaseAdmin.from("deals").update(patch).eq("id", ctx.deal.id);
      return "recorded";
    }
    case "send_booking_link": {
      const url = (await getSecret("CALENDLY_BOOKING_URL")) || "https://calendly.com/dominic-theosirisai/cleaning-gameplan";
      if (ctx.deal && ctx.deal.stage === "lead") {
        await supabaseAdmin.from("deals").update({ stage: "contacted", updated_at: new Date().toISOString() }).eq("id", ctx.deal.id);
      }
      return JSON.stringify({ url });
    }
    case "advance_stage": {
      const stage = String(input.stage ?? "");
      if (!ctx.deal || !["lead", "contacted", "demo-booked", "lost"].includes(stage)) return "invalid";
      await supabaseAdmin.from("deals").update({ stage, updated_at: new Date().toISOString() }).eq("id", ctx.deal.id);
      return "moved to " + stage;
    }
    case "log_note": {
      await supabaseAdmin.from("contact_notes").insert({
        contact_id: ctx.contact.id,
        text: `🤖 ${agentName()}: ${String(input.text ?? "").slice(0, 1000)}`,
        date: new Date().toISOString(),
        status: "warm",
      });
      return "noted";
    }
    case "schedule_followup": {
      const hours = Math.max(0.1, Math.min(24 * 30, Number(input.hours) || 24));
      const message = String(input.message ?? "").slice(0, 320);
      if (!message) return "no message";
      await supabaseAdmin.from("scheduled_tasks").insert({
        contact_id: ctx.contact.id,
        deal_id: ctx.deal?.id ?? null,
        task_type: "agent_followup",
        payload: { content: message },
        run_at: new Date(Date.now() + hours * 3600_000).toISOString(),
      });
      return "scheduled";
    }
    case "opt_out": {
      const e164 = toE164(ctx.phone);
      await supabaseAdmin.from("sms_suppressions").upsert(
        { phone: e164, reason: "stop", contact_id: ctx.contact.id },
        { onConflict: "phone" },
      );
      await cancelPendingTasks(ctx.contact.id);
      return "opted out";
    }
    case "handoff_to_human": {
      const summary = String(input.summary ?? "").slice(0, 500);
      const reason = String(input.reason ?? "").slice(0, 200);
      if (ctx.deal) {
        await supabaseAdmin.from("deals").update({
          next_action: `Human handoff: ${reason}`.slice(0, 200),
          next_action_date: new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        }).eq("id", ctx.deal.id);
      }
      await assignToCloser({ dealId: ctx.deal?.id ?? null, contactId: ctx.contact.id, reason, summary });
      return "handed off to a human";
    }
    default:
      return "unknown tool";
  }
}

async function callAnthropic(apiKey: string, body: unknown): Promise<any> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

// Run one agent turn for a contact. The inbound message must already be stored
// in agent_messages. Returns the reply text actually sent (or null).
export async function runSalesAgentTurn(contactId: number): Promise<string | null> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    console.error("[salesAgent] ANTHROPIC_API_KEY missing");
    return null;
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, phone_jsonb, lead_source, company_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return null;

  let companyName: string | null = null;
  if ((contact as ContactRow).company_id) {
    const { data: co } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", (contact as ContactRow).company_id)
      .maybeSingle();
    companyName = co?.name ?? null;
  }

  const phone = firstPhone(contact as ContactRow);
  if (!phone) return null;

  // Opted out? never reply.
  const { data: sup } = await supabaseAdmin.from("sms_suppressions").select("id").eq("phone", toE164(phone)).maybeSingle();
  if (sup) return null;

  const deal = await getOpenDeal(contactId);
  const history = await loadHistory(contactId);
  if (history.length === 0) return null; // nothing to respond to

  const model = Deno.env.get("SALES_AGENT_MODEL") || DEFAULT_MODEL;
  const ctx = { contact: contact as ContactRow, deal, phone };

  const messages: Array<{ role: string; content: unknown }> = history.map((m) => ({ role: m.role, content: m.content }));
  const tools = toolDefs();
  const system = systemPrompt(contact as ContactRow, deal, companyName);

  let replyText = "";
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await callAnthropic(apiKey, { model, max_tokens: MAX_TOKENS, system, tools, messages });
    const content: any[] = Array.isArray(resp.content) ? resp.content : [];
    replyText = content.filter((c) => c?.type === "text").map((c) => c.text).join(" ").trim();

    if (resp.stop_reason !== "tool_use") break;

    // Append assistant turn (with tool_use blocks), then run tools.
    messages.push({ role: "assistant", content });
    const results: any[] = [];
    for (const block of content) {
      if (block?.type === "tool_use") {
        let out = "ok";
        try {
          out = await execTool(block.name, block.input ?? {}, ctx);
        } catch (e) {
          console.error("[salesAgent] tool failed", block.name, e);
          out = "error";
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: out });
      }
    }
    messages.push({ role: "user", content: results });
  }

  const finalText = replyText.trim();
  if (!finalText) return null; // agent chose silence (e.g. after opt_out)

  if (!isCleanSms(finalText)) {
    console.warn("[salesAgent] reply not GSM-7/160-clean:", finalText.length, "chars");
  }

  const send = await sendSalesSms(phone, finalText);
  if (!send.ok) {
    console.error("[salesAgent] send failed", send.status, send.body);
    return null;
  }

  await supabaseAdmin.from("agent_messages").insert({
    contact_id: contactId,
    deal_id: deal?.id ?? null,
    direction: "outbound",
    body: finalText,
  });
  try {
    await supabaseAdmin.from("contact_notes").insert({
      contact_id: contactId,
      text: `🤖 ${agentName()} (AI) -> ${phone}:\n${finalText}`,
      date: new Date().toISOString(),
      status: "warm",
    });
  } catch (_e) { /* visibility only */ }

  return finalText;
}

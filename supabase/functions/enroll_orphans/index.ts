// enroll_orphans — the safety net that guarantees NO warm lead sits in the CRM
// without a drip, no matter which door it came through.
//
// Why: leads don't only enter via lead_inbound. A Zapier writes Meta Lead Ads
// straight into contacts (lead_source "Meta Ads"), reps import manually, and
// future tools will do their own inserts. Those rows historically got a deal
// but NO cadence — nobody texted, emailed, or called them. This sweep finds
// every recent warm contact whose identity has no cadence and enrolls them
// through the same _shared/enrollment.ts path lead_inbound uses (speed-to-lead
// SMS + email, nurture, double-dial call cadence).
//
// Runs every 10 minutes via pg_cron (see CRON_SETUP.sql). Self-throttling:
// MAX_ENROLL_PER_RUN here plus the shared 60-tasks/hour flood cap inside
// enrollLeadCadence, so a large backfill drains gradually instead of blasting.
//
// Auth: X-DISPATCH-TOKEN == DISPATCH_TASKS_TOKEN (same secret as the
// dispatcher, it's the same trust domain: pg_cron).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { toE164 } from "../_shared/quoSales.ts";
import { enrollLeadCadence, ensureOpenDeal } from "../_shared/enrollment.ts";
import {
  normalizeLeadSource,
  isColdSource,
  magnetFromLeadSource,
} from "../_shared/leadPlaybooks.ts";
import { hasBookedDemo } from "../_shared/bookingGuard.ts";

const LOOKBACK_DAYS = 30;
const MAX_ENROLL_PER_RUN = 10;
const SCAN_LIMIT = 200;

function firstOf(jsonb: unknown, key: "email" | "number"): string | null {
  if (!Array.isArray(jsonb)) return null;
  for (const entry of jsonb) {
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    if (entry && typeof entry === "object") {
      const v = (entry as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

interface ContactRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  lead_source: string | null;
  company_id: number | null;
  email_jsonb: unknown;
  phone_jsonb: unknown;
  attribution: Record<string, unknown> | null;
}

const handle = async (req: Request) => {
  if (req.method !== "POST")
    return createErrorResponse(405, "Method Not Allowed");

  const expected = Deno.env.get("DISPATCH_TASKS_TOKEN");
  const provided = req.headers.get("X-DISPATCH-TOKEN");
  if (!expected || provided !== expected)
    return createErrorResponse(401, "Unauthorized");

  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 3600_000,
  ).toISOString();

  // Candidates: recent contacts with a KNOWN source. lead_source null is the
  // cold outbound list — never auto-drip those from here.
  const { data: candidates, error } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, first_name, last_name, lead_source, company_id, email_jsonb, phone_jsonb, attribution",
    )
    .gte("first_seen", since)
    .not("lead_source", "is", null)
    .order("first_seen", { ascending: false })
    .limit(SCAN_LIMIT);
  if (error) {
    console.error("[enroll_orphans] candidate query failed", error);
    return createErrorResponse(500, "query failed");
  }

  const summary: Record<string, number> = { scanned: 0, enrolled: 0 };
  const bump = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);

  for (const c of (candidates ?? []) as ContactRow[]) {
    if (summary.enrolled >= MAX_ENROLL_PER_RUN) break;
    summary.scanned++;

    const source = normalizeLeadSource(c.lead_source ?? "");
    if (isColdSource(source)) {
      bump("skipped_cold");
      continue;
    }
    const e164 = toE164(firstOf(c.phone_jsonb, "number") ?? "");
    const email = (firstOf(c.email_jsonb, "email") ?? "").toLowerCase();
    if (!e164 && !email) {
      bump("skipped_no_channel");
      continue;
    }

    // In a live conversation already (texted the sales line / replied by email
    // / a real phone conversation - all recorded as inbound agent_messages)?
    // The agent/human owns them - don't start a chase cadence over the top.
    const { data: inboundMsg } = await supabaseAdmin
      .from("agent_messages")
      .select("id")
      .eq("contact_id", c.id)
      .eq("direction", "inbound")
      .limit(1);
    if (inboundMsg && inboundMsg.length) {
      bump("skipped_in_conversation");
      continue;
    }

    // Belt-and-braces for calls logged before quo_call_events wrote transcript
    // markers: any inbound call, or an outbound call long enough to be a real
    // conversation, also counts as in-conversation. Two targeted exists-checks
    // instead of sampling rows — a sample can miss the one call that matters.
    const { data: inboundCall } = await supabaseAdmin
      .from("call_logs")
      .select("id")
      .eq("contact_id", c.id)
      .eq("direction", "inbound")
      .limit(1);
    const { data: longCall } =
      inboundCall && inboundCall.length
        ? { data: inboundCall }
        : await supabaseAdmin
            .from("call_logs")
            .select("id")
            .eq("contact_id", c.id)
            .gte("duration", 120)
            .limit(1);
    if (longCall && longCall.length) {
      bump("skipped_in_conversation");
      continue;
    }

    // Booked (on any duplicate contact) = past the chase phase.
    if (await hasBookedDemo(c.id)) {
      bump("skipped_booked");
      continue;
    }

    const name =
      `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || e164 || email;
    const dealId = await ensureOpenDeal({
      contactId: c.id,
      name,
      source,
      companyId: c.company_id,
    });

    // Magnet: attribution first, else recover it from the raw lead_source label
    // ("Lead Magnet — Cleaning Guide") that the pre-fix crm-sync path wrote.
    const magnet =
      (typeof c.attribution?.lead_magnet === "string"
        ? (c.attribution.lead_magnet as string)
        : "") || magnetFromLeadSource(c.lead_source);
    const language =
      c.attribution?.language === "es" ? ("es" as const) : ("en" as const);
    const result = await enrollLeadCadence({
      contactId: c.id,
      dealId,
      source,
      magnet,
      e164: e164 || null,
      email: email || null,
      language,
    });

    if (result.enqueued > 0) {
      summary.enrolled++;
      console.warn("[enroll_orphans] enrolled", {
        contactId: c.id,
        source,
        enqueued: result.enqueued,
        callSteps: result.callSteps,
      });
      try {
        await supabaseAdmin.from("contact_notes").insert({
          contact_id: c.id,
          text: `🤖 Auto-enrolled in the follow-up drip (${result.enqueued} touches incl. ${result.callSteps} call steps) — source: ${source}.`,
          date: new Date().toISOString(),
          status: "warm",
        });
      } catch {
        /* visibility only */
      }
    } else if (result.skipped === "flood cap") {
      bump("skipped_flood_cap");
      break; // every further enrollment this run would hit the same cap
    } else if (result.skipped === "cadence already active") {
      bump("skipped_has_cadence");
    } else {
      bump("skipped_other");
    }
  }

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

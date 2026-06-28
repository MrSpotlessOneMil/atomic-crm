// sales_agent — thin HTTP entry point around the agent engine, for manual
// testing / simulation. In production the agent is driven by quo_inbound, which
// imports runSalesAgentTurn directly (no internal HTTP hop).
//
// Auth: X-DISPATCH-TOKEN == DISPATCH_TASKS_TOKEN (internal-only).
// Body: { contact_id: number, inbound?: string }
//   - if `inbound` is given, it's recorded as an inbound message first, so you
//     can simulate a full turn end-to-end without a real text.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { runSalesAgentTurn } from "../_shared/salesAgent.ts";

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  const expected = Deno.env.get("DISPATCH_TASKS_TOKEN");
  const provided = req.headers.get("X-DISPATCH-TOKEN");
  if (!expected || provided !== expected) return createErrorResponse(401, "Unauthorized");

  let body: { contact_id?: number; inbound?: string };
  try {
    body = await req.json();
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }
  const contactId = Number(body.contact_id);
  if (!Number.isFinite(contactId) || contactId <= 0) {
    return createErrorResponse(400, "contact_id required");
  }

  if (typeof body.inbound === "string" && body.inbound.trim()) {
    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("id")
      .contains("contact_ids", [contactId])
      .in("stage", ["lead", "contacted", "demo-booked", "demo-done", "proposal-sent", "in-negociation"])
      .limit(1);
    await supabaseAdmin.from("agent_messages").insert({
      contact_id: contactId,
      deal_id: deal?.[0]?.id ?? null,
      direction: "inbound",
      body: body.inbound.trim().slice(0, 1000),
    });
  }

  const reply = await runSalesAgentTurn(contactId);
  return new Response(JSON.stringify({ ok: true, reply }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

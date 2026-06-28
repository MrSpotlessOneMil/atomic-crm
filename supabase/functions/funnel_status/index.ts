// funnel_status — read-only diagnostic snapshot of the sales funnel.
// Auth: X-DISPATCH-TOKEN == DISPATCH_TASKS_TOKEN. Sends nothing; only reads.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

// deno-lint-ignore no-explicit-any
async function count(table: string, build: (q: any) => any = (q) => q): Promise<number> {
  const { count } = await build(supabaseAdmin.from(table).select("*", { count: "exact", head: true }));
  return count ?? 0;
}

const handle = async (req: Request) => {
  const expected = Deno.env.get("DISPATCH_TASKS_TOKEN");
  const provided = req.headers.get("X-DISPATCH-TOKEN");
  if (!expected || provided !== expected) return createErrorResponse(401, "Unauthorized");

  const now = new Date().toISOString();

  // deno-lint-ignore no-explicit-any
  const st = (b: (q: any) => any) => count("scheduled_tasks", b);
  const tasks = {
    total: await count("scheduled_tasks"),
    pending: await st((q) => q.eq("status", "pending")),
    overdue_pending: await st((q) => q.eq("status", "pending").lt("run_at", now)),
    processing: await st((q) => q.eq("status", "processing")),
    sent: await st((q) => q.eq("status", "sent")),
    failed: await st((q) => q.eq("status", "failed")),
    canceled: await st((q) => q.eq("status", "canceled")),
  };

  const agent = {
    outbound: await count("agent_messages", (q) => q.eq("direction", "outbound")),
    inbound: await count("agent_messages", (q) => q.eq("direction", "inbound")),
  };

  const { data: recentTasks } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("id, task_type, status, run_at, attempts, last_error, contact_id")
    .order("id", { ascending: false })
    .limit(12);
  const { data: recentContacts } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, lead_source, first_seen")
    .order("id", { ascending: false })
    .limit(8);
  const { data: recentMsgs } = await supabaseAdmin
    .from("agent_messages")
    .select("id, contact_id, direction, body, created_at")
    .order("id", { ascending: false })
    .limit(10);

  const { data: deals } = await supabaseAdmin.from("deals").select("stage, sales_id");
  const dealStages: Record<string, number> = {};
  let funnelDeals = 0;
  for (const d of deals ?? []) {
    dealStages[d.stage] = (dealStages[d.stage] ?? 0) + 1;
    if (d.sales_id === null) funnelDeals++;
  }

  const { data: cfg } = await supabaseAdmin
    .from("integration_secrets")
    .select("key")
    .in("key", ["SALES_AGENT_QUO_NUMBER", "CALENDLY_BOOKING_URL", "QUO_API_KEY", "ANTHROPIC_API_KEY"]);

  const diagnosis = {
    leads_reaching_funnel: tasks.total > 0 || agent.outbound > 0 || agent.inbound > 0
      ? "YES — at least one lead hit lead_inbound"
      : "NO — nothing has come through lead_inbound yet (Apps Script not wired?)",
    dispatcher_running: tasks.overdue_pending === 0
      ? (tasks.sent > 0 ? "YES — tasks are being sent" : "no overdue tasks, but nothing sent yet")
      : `NO — ${tasks.overdue_pending} tasks are pending past their run time (cron not scheduled)`,
    any_sms_sent: tasks.sent > 0 || agent.outbound > 0,
  };

  return new Response(
    JSON.stringify({ now, diagnosis, tasks, agent, deal_stages: dealStages, funnel_deals_unassigned: funnelDeals, config_present: (cfg ?? []).map((r) => r.key), recent_tasks: recentTasks, recent_contacts: recentContacts, recent_agent_messages: recentMsgs }, null, 2),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

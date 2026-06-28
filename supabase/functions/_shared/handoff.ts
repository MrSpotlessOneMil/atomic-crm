// "AI books, humans close" handoff. The AI works leads unassigned; when a deal
// is booked (or the agent escalates), we hand it to the human closer — set
// deal.sales_id = CLOSER_SALES_ID (integration_secrets) and notify them. Closing
// the deal then pays the closer via the existing deal_payouts won-trigger.

import { supabaseAdmin } from "./supabaseAdmin.ts";

export async function assignToCloser(opts: {
  dealId: number | null;
  contactId: number;
  reason: string;
  summary: string;
}): Promise<void> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "CLOSER_SALES_ID")
    .single();
  const closerId = data?.value ? Number(data.value) : null;
  const hasCloser = closerId !== null && Number.isFinite(closerId);

  if (opts.dealId && hasCloser) {
    await supabaseAdmin
      .from("deals")
      .update({ sales_id: closerId, updated_at: new Date().toISOString() })
      .eq("id", opts.dealId);
  }

  // Notify the closer, or fall back to all admins if no closer is configured.
  let targets: number[] = [];
  if (hasCloser) {
    targets = [closerId as number];
  } else {
    const { data: admins } = await supabaseAdmin
      .from("sales")
      .select("id")
      .eq("administrator", true)
      .eq("disabled", false);
    targets = (admins ?? []).map((a) => a.id);
  }

  for (const sid of targets) {
    await supabaseAdmin.from("notifications").insert({
      sales_id: sid,
      type: "agent_handoff",
      payload: { contact_id: opts.contactId, deal_id: opts.dealId, reason: opts.reason, summary: opts.summary },
    });
  }
}

// Teardown for bridged call tasks. Once a call_task step is due, dispatch_tasks
// bridges it into the human `tasks` table (type 'call'), where it stays open
// until a rep logs the call - OR until the lead books / opts out, at which
// point chasing them by phone is over and we close the open items here.
// (Future scheduled_tasks steps are cancelled separately by the callers /
// booking guard; this handles only the already-bridged human rows.)

import { supabaseAdmin } from "./supabaseAdmin.ts";

export async function closeOpenCallTasks(contactId: number): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("tasks")
      .update({ done_date: new Date().toISOString() })
      .eq("contact_id", contactId)
      .eq("type", "call")
      .is("done_date", null);
    if (error) console.error("[callTasks] closeOpenCallTasks failed", error);
  } catch (e) {
    console.error("[callTasks] closeOpenCallTasks threw", e);
  }
}

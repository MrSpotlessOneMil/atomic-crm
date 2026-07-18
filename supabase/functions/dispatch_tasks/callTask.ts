// call_task handler: bridges a due double-dial step into HUMAN work.
//
// A call_task row in scheduled_tasks is only the TIMER. When it comes due, this
// handler creates the open obligation a rep actually works from:
//   * a `tasks` row (type 'call', due now, open until done_date) -> the
//     dashboard Call Queue, and
//   * a 'call_due' notification to the assigned rep (or all admins for
//     pool leads).
// The scheduled row is then marked 'sent' and never touched again - the human
// obligation lives in `tasks` until the rep logs the call (LogCallButton closes
// it) or the lead books / opts out (closeOpenCallTasks).
//
// Why bridge instead of leaving the row pending until a human acts: the drain
// query is `status='pending' AND run_at <= now LIMIT 25` - anything human-speed
// left pending would sit at the head of every batch and starve SMS/email sends.

import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { toE164 } from "../_shared/quoSales.ts";
import {
  MAX_ATTEMPTS,
  type Outcome,
  type TaskRow,
  defaultTz,
  firstPhone,
  isQuietHours,
  quietHoursDeferMs,
  setStatus,
} from "./taskUtil.ts";

// Human-facing line shown in the Call Queue / tasks list.
export function callTaskText(opts: {
  step: unknown;
  of: unknown;
  phone: string;
  source?: unknown;
  leadMagnet?: unknown;
}): string {
  const step = Number(opts.step) || 1;
  const of = Number(opts.of) || step;
  let text = `Double dial ${step}/${of} - call twice back-to-back, no answer = voicemail + text - ${opts.phone}`;
  if (typeof opts.source === "string" && opts.source)
    text += ` - via ${opts.source}`;
  if (typeof opts.leadMagnet === "string" && opts.leadMagnet)
    text += ` (${opts.leadMagnet})`;
  return text;
}

export async function handleCallTask(task: TaskRow): Promise<Outcome> {
  const payload = task.payload ?? {};
  if (!task.contact_id) {
    await setStatus(task.id, { status: "canceled", last_error: "no contact" });
    return "skipped";
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, sales_id, phone_jsonb")
    .eq("id", task.contact_id)
    .maybeSingle();

  const phone = firstPhone(contact ?? null, payload.to);
  if (!phone) {
    await setStatus(task.id, {
      status: "canceled",
      last_error: "no phone (canceled)",
    });
    return "skipped";
  }

  const { data: sup } = await supabaseAdmin
    .from("sms_suppressions")
    .select("id")
    .eq("phone", toE164(phone))
    .maybeSingle();
  if (sup) {
    await setStatus(task.id, {
      status: "canceled",
      last_error: "suppressed (opt-out)",
    });
    return "skipped";
  }

  // Lead replied since enrollment -> the live conversation owns them now
  // (quo_inbound cancels pending call_tasks on reply; this is the race/other-
  // channel backstop).
  const enrolledAt =
    typeof payload.enrolled_at === "string" ? payload.enrolled_at : null;
  if (enrolledAt) {
    const { data: replies } = await supabaseAdmin
      .from("agent_messages")
      .select("id")
      .eq("contact_id", task.contact_id)
      .eq("direction", "inbound")
      .gt("created_at", enrolledAt)
      .limit(1);
    if (replies && replies.length) {
      await setStatus(task.id, {
        status: "canceled",
        last_error: "lead replied",
      });
      return "skipped";
    }
  }

  // Coalesce: if an open bridged call task is already on the rep's plate for
  // this contact (e.g. cron downtime made several steps due at once), don't
  // stack another CALL NOW item.
  const { data: openTask } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("contact_id", task.contact_id)
    .eq("type", "call")
    .is("done_date", null)
    .limit(1);
  if (openTask && openTask.length) {
    await setStatus(task.id, {
      status: "sent",
      payload: { ...payload, coalesced: true },
    });
    return "skipped";
  }

  // Quiet hours -> defer straight to the lead's next 8am (no stagger needed;
  // call sessions are human-paced anyway).
  if (isQuietHours(defaultTz(payload.tz))) {
    await setStatus(task.id, {
      status: "pending",
      run_at: new Date(
        Date.now() + quietHoursDeferMs(defaultTz(payload.tz)),
      ).toISOString(),
    });
    return "deferred";
  }

  const text = callTaskText({
    step: payload.step,
    of: payload.of,
    phone,
    source: payload.source,
    leadMagnet: payload.lead_magnet,
  });
  const ins = await supabaseAdmin
    .from("tasks")
    .insert({
      contact_id: task.contact_id,
      type: "call",
      text,
      due_date: new Date().toISOString(),
      sales_id: contact?.sales_id ?? null,
    })
    .select("id")
    .single();

  if (ins.error) {
    // Transient bridge failure -> backoff retry, else give up (same semantics
    // as the email handler). Once bridged, a call task never retry-fails - the
    // human obligation persists in `tasks`.
    const attempts = (task.attempts ?? 0) + 1;
    const errBody = JSON.stringify(ins.error).slice(0, 500);
    if (attempts < MAX_ATTEMPTS) {
      await setStatus(task.id, {
        status: "pending",
        attempts,
        run_at: new Date(Date.now() + attempts * 2 * 60_000).toISOString(),
        last_error: errBody,
      });
      return "deferred";
    }
    await setStatus(task.id, {
      status: "failed",
      attempts,
      last_error: errBody,
    });
    return "failed";
  }

  // Notify the assigned rep, or every active admin for unassigned pool leads
  // (mirrors _shared/handoff.ts). Best-effort - a notification hiccup must not
  // fail the bridge.
  try {
    let targets: number[] = [];
    if (contact?.sales_id) {
      targets = [contact.sales_id as number];
    } else {
      const { data: admins } = await supabaseAdmin
        .from("sales")
        .select("id")
        .eq("administrator", true)
        .eq("disabled", false);
      targets = (admins ?? []).map((a: { id: number }) => a.id);
    }
    for (const sid of targets) {
      await supabaseAdmin.from("notifications").insert({
        sales_id: sid,
        type: "call_due",
        payload: {
          contact_id: task.contact_id,
          deal_id: task.deal_id,
          task_id: ins.data.id,
          step: payload.step ?? null,
          phone,
        },
      });
    }
  } catch (e) {
    console.error("[callTask] notification insert failed", e);
  }

  await setStatus(task.id, {
    status: "sent",
    payload: { ...payload, task_id: ins.data.id },
  });
  return "sent";
}

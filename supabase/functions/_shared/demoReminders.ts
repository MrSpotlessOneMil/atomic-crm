// Schedule the playbook "show-rate stack" for a booked demo. Extracted from
// calendly_webhook so every booking path (Calendly, the AI agent's
// book_appointment tool, the public book_slot widget) gets the SAME stack:
//
//   * instant auto-confirmation text (labeled automated, invites a reply)
//   * reminder_sms at 24h / 12h / 3h / 1h before (salesCopy.REMINDERS), each
//     with a skip_after guard so quiet-hours can never push one past the demo
//   * a no_show_check just after the demo ends
//   * a PULL-FORWARD call task when the demo is booked 2+ days out (playbook:
//     same-day shows highest - call, confirm, offer today)
//   * a night-before rep prompt for the MANUAL personal text (the playbook
//     wants a human touch on top of the automated reminders)
//
// Times are rendered in the LEAD's timezone (explicit timeZone from the
// booking source, else the phone's area code, else the global setting) — a
// lead in LA being told "Wed 2:00 PM" that means Eastern books a no-show.
// Spanish-language leads (attribution.language === "es") get the ES copy.
//
// The dispatcher (dispatch_tasks) already handles reminder_sms/no_show_check.
// Rows are enqueued even while sends are paused: the dispatcher HOLDS the
// queue, so reminders flush on resume instead of silently never existing.

import { supabaseAdmin } from "./supabaseAdmin.ts";
import {
  REMINDERS,
  REMINDERS_ES,
  CONFIRMATION,
  CONFIRMATION_ES,
  render,
} from "./salesCopy.ts";
import { tzForPhone } from "./areaTz.ts";

const repName = () => Deno.env.get("SALES_AGENT_NAME") || "Robin";

const PULL_FORWARD_MS = 48 * 3600_000;

// Human-friendly demo time in the demo timezone, e.g. "Wed 2:00 PM".
export function fmtDemoTime(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "America/Los_Angeles",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

function firstPhoneOf(jsonb: unknown): string | null {
  if (!Array.isArray(jsonb)) return null;
  for (const e of jsonb) {
    if (typeof e === "string" && e.trim()) return e;
    if (e && typeof e === "object") {
      const n = (e as Record<string, unknown>).number;
      if (typeof n === "string" && n.trim()) return n;
    }
  }
  return null;
}

// Rep task + call_due notification (assigned rep, else all active admins) —
// the same fan-out the call cadence bridge uses.
async function repTask(opts: {
  contactId: number;
  dealId: number | null;
  salesId: number | null;
  type: string;
  text: string;
  dueISO: string;
  notify: boolean;
}): Promise<void> {
  try {
    const ins = await supabaseAdmin
      .from("tasks")
      .insert({
        contact_id: opts.contactId,
        type: opts.type,
        text: opts.text,
        due_date: opts.dueISO,
        sales_id: opts.salesId,
      })
      .select("id")
      .single();
    if (ins.error || !opts.notify) return;
    let targets: number[] = [];
    if (opts.salesId) {
      targets = [opts.salesId];
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
          contact_id: opts.contactId,
          deal_id: opts.dealId,
          task_id: ins.data.id,
          pull_forward: true,
        },
      });
    }
  } catch (e) {
    console.error("[demoReminders] repTask failed", e);
  }
}

export async function scheduleDemoReminders(opts: {
  contactId: number;
  dealId: number | null;
  startISO: string;
  durationMinutes?: number;
  joinUrl?: string | null;
  timeZone?: string;
}): Promise<void> {
  const startMs = Date.parse(opts.startISO);
  if (!Number.isFinite(startMs)) return;
  const endMs = startMs + (opts.durationMinutes ?? 15) * 60_000;
  const nowMs = Date.now();

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("sales_id, phone_jsonb, attribution")
    .eq("id", opts.contactId)
    .maybeSingle();
  const language =
    (contact?.attribution as Record<string, unknown> | null)?.language === "es"
      ? ("es" as const)
      : ("en" as const);
  const tz =
    opts.timeZone ||
    tzForPhone(firstPhoneOf(contact?.phone_jsonb)) ||
    Deno.env.get("QUIET_HOURS_TZ") ||
    "America/Los_Angeles";

  const joinLine = opts.joinUrl
    ? language === "es"
      ? ` aqui esta el link: ${opts.joinUrl}`
      : ` here's the link: ${opts.joinUrl}`
    : "";
  const vars = {
    rep_name: repName(),
    demo_time: fmtDemoTime(opts.startISO, tz),
    join_link: opts.joinUrl || "",
    join_line: joinLine,
  };
  const basePayload = { tz, skip_after: new Date(startMs).toISOString() };

  const rows: Record<string, unknown>[] = [];

  // Instant confirmation (only when the demo is still ahead of us).
  if (startMs > nowMs) {
    rows.push({
      task_type: "reminder_sms",
      contact_id: opts.contactId,
      deal_id: opts.dealId,
      payload: {
        content: render(
          language === "es" ? CONFIRMATION_ES : CONFIRMATION,
          vars,
        ),
        key: "booking_confirmation",
        ...basePayload,
      },
      run_at: new Date(nowMs).toISOString(),
    });
  }

  for (const r of language === "es" ? REMINDERS_ES : REMINDERS) {
    const runAt = startMs - r.minutesBefore * 60_000;
    if (runAt <= nowMs - 60_000) continue; // drop already-past reminders
    rows.push({
      task_type: "reminder_sms",
      contact_id: opts.contactId,
      deal_id: opts.dealId,
      payload: {
        content: render(r.template, vars),
        key: r.key,
        ...basePayload,
      },
      run_at: new Date(runAt).toISOString(),
    });
  }

  rows.push({
    task_type: "no_show_check",
    contact_id: opts.contactId,
    deal_id: opts.dealId,
    payload: { key: "no_show", demo_at: opts.startISO, tz },
    run_at: new Date(endMs).toISOString(),
  });

  if (rows.length) {
    const r = await supabaseAdmin.from("scheduled_tasks").insert(rows);
    if (r.error) console.error("[demoReminders] enqueue failed", r.error);
  }

  const salesId = (contact?.sales_id as number | null) ?? null;

  // Pull-forward call (playbook "Once booked"): booked 2+ days out -> a rep
  // calls NOW to confirm details and offer today's cancellation slot.
  if (startMs - nowMs >= PULL_FORWARD_MS) {
    const days = Math.round((startMs - nowMs) / 86_400_000);
    await repTask({
      contactId: opts.contactId,
      dealId: opts.dealId,
      salesId,
      type: "call",
      text: `Pull-forward call - demo booked for ${vars.demo_time} (${days} days out). Call to confirm details, then offer a today/tomorrow slot ("I had a cancellation at 10am today, we could just knock it out now"). Same-day shows highest.`,
      dueISO: new Date(nowMs).toISOString(),
      notify: true,
    });
  }

  // Night-before manual personal text (on top of the automated reminders).
  const nightBefore = startMs - 26 * 3600_000;
  if (nightBefore > nowMs) {
    await repTask({
      contactId: opts.contactId,
      dealId: opts.dealId,
      salesId,
      type: "text",
      text: `Send the personal night-before text for tomorrow's ${vars.demo_time} demo (playbook: "Pumped for tomorrow... want the phone-script pack as a PDF or a Google Doc?"). Manual + personal, from your own phone.`,
      dueISO: new Date(nightBefore).toISOString(),
      notify: false,
    });
  }
}

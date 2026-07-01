// Schedule the demo reminder cadence (+ no-show check) for a booked demo.
// Extracted from calendly_webhook so the Google-Calendar booking path (the AI
// agent's book_appointment tool) and Calendly use the SAME reminder logic.
//
// Mirrors the original enqueue: REMINDERS from salesCopy.ts rendered with
// {{rep_name}}/{{demo_time}}/{{join_link}}, written as 'reminder_sms' tasks with
// a `skip_after` guard, plus a 'no_show_check' just after the demo ends. The
// dispatcher (dispatch_tasks) already handles both task types.

import { supabaseAdmin } from "./supabaseAdmin.ts";
import { REMINDERS, render } from "./salesCopy.ts";

const repName = () => Deno.env.get("SALES_AGENT_NAME") || "Robin";

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

  const vars = {
    rep_name: repName(),
    demo_time: fmtDemoTime(opts.startISO, opts.timeZone),
    join_link: opts.joinUrl || "",
  };

  const rows: Record<string, unknown>[] = REMINDERS.map((r) => ({
    task_type: "reminder_sms",
    contact_id: opts.contactId,
    deal_id: opts.dealId,
    payload: { content: render(r.template, vars), key: r.key, skip_after: new Date(startMs).toISOString() },
    run_at: new Date(startMs - r.minutesBefore * 60_000).toISOString(),
  })).filter((row) => Date.parse(row.run_at as string) > Date.now() - 60_000); // drop already-past reminders

  rows.push({
    task_type: "no_show_check",
    contact_id: opts.contactId,
    deal_id: opts.dealId,
    payload: { key: "no_show", demo_at: opts.startISO },
    run_at: new Date(endMs).toISOString(),
  });

  if (rows.length) {
    const r = await supabaseAdmin.from("scheduled_tasks").insert(rows);
    if (r.error) console.error("[demoReminders] enqueue failed", r.error);
  }
}

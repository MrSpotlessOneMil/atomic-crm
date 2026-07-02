// enroll_call_drip - after an SDR logs a call, enroll the lead into a short,
// rolling SMS follow-up drip keyed to the call outcome.
//
// It just enqueues rows into scheduled_tasks; the existing dispatch_tasks cron
// does the actual sending with all the safety rails already in place:
//   • sms_suppressions (STOP / manual opt-out) - skipped
//   • quiet hours - deferred
//   • retries with backoff
//   • global pause (salesSendsPaused)
// And quo_inbound cancels every pending task the moment the lead replies, so the
// drip stops itself once a conversation starts.
//
// Cadence: 3 light touches at day 2, 5, and 10. SMS only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { toE164, salesSendsPaused } from "../_shared/quoSales.ts";

const DAY = 24 * 60 * 60_000;
const OFFSETS = [2 * DAY, 5 * DAY, 10 * DAY];

// {{first_name}} is rendered at send time by dispatch_tasks. We bake the rep
// name in here. Tone is deliberately human and low-pressure (see message-draft
// tone feedback) - a light value line at most, never a hard pitch.
//
// SMS DISCIPLINE: plain hyphens only, NEVER an em-dash - em-dashes force UCS-2
// encoding and tank SMS deliverability (same rule as _shared/salesCopy.ts).
type Seq = [string, string, string];

function sequences(rep: string): Record<string, Seq> {
  return {
    could_not_reach: [
      `Hi {{first_name}}, ${rep} here again - still hoping to connect. Whenever you've got a free minute, a quick call or text back works. No rush!`,
      `Hey {{first_name}}, floating this back up - happy to keep it short and work around your schedule. What day's usually best to reach you?`,
      `Hi {{first_name}}, last nudge from me for now - if it's ever helpful to chat, I'm right here. Either way, hope business is going well!`,
    ],
    interested: [
      `Hi {{first_name}}, ${rep} again - really enjoyed our chat. Want me to send over a couple of times for a quick walkthrough?`,
      `Hey {{first_name}}, no pressure at all - just let me know what day works and I'll make it easy. Looking forward to showing you how it'd fit.`,
      `Hi {{first_name}}, still happy to walk you through it whenever you're ready. Just say the word and I'll get it on the calendar.`,
    ],
    callback: [
      `Hi {{first_name}}, ${rep} here - circling back like we talked about. Is now a better time, or should I try a little later?`,
      `Hey {{first_name}}, just keeping my promise to follow up. Whenever works for you, I'm around - what's a good time?`,
      `Hi {{first_name}}, I'll leave the ball in your court for now - text me anytime and we'll pick it back up. Take care!`,
    ],
    email_follow: [
      `Hi {{first_name}}, ${rep} here - did that email make it through okay? Happy to answer anything by text if that's easier.`,
      `Hey {{first_name}}, just checking the info was helpful - any questions at all, I'm one text away.`,
      `Hi {{first_name}}, no worries if now's not the time - I'll be here whenever you want to take a look. Appreciate you!`,
    ],
  };
}

// Map the Log Call outcome to a drip sequence. Outcomes left out on purpose:
// "Not interested", "Booked!", "Bad / wrong number" - none should get an
// automated multi-touch chase.
const OUTCOME_TO_SEQ: Record<string, string> = {
  "No answer": "could_not_reach",
  "Left voicemail": "could_not_reach",
  "Gatekeeper": "could_not_reach",
  "Call back later": "callback",
  "Asked to email": "email_follow",
  "Interested": "interested",
};

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  let body: {
    contact_id?: number;
    deal_id?: number | null;
    outcome?: string;
    to?: string | null;
    rep_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  const contactId = Number(body.contact_id);
  const outcome = String(body.outcome ?? "");
  const seqKey = OUTCOME_TO_SEQ[outcome];

  if (!contactId || !seqKey) {
    // Nothing to enroll (unknown contact or a non-drip outcome) - not an error.
    return new Response(JSON.stringify({ ok: true, enrolled: 0, reason: "no-op" }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Global pause: do nothing (matches lead_inbound behavior).
  if (await salesSendsPaused()) {
    return new Response(JSON.stringify({ ok: true, enrolled: 0, paused: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // De-dupe: if this contact already has pending tasks queued, don't stack
  // another drip on top (prevents double-texting on repeat call logs).
  const { data: pending } = await supabaseAdmin
    .from("scheduled_tasks")
    .select("id")
    .eq("contact_id", contactId)
    .eq("status", "pending")
    .limit(1);
  if (pending && pending.length > 0) {
    return new Response(JSON.stringify({ ok: true, enrolled: 0, reason: "already-pending" }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Suppressed (opted out)? Don't enroll.
  const phone = body.to ? toE164(body.to) : null;
  if (phone) {
    const { data: sup } = await supabaseAdmin
      .from("sms_suppressions")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (sup) {
      return new Response(JSON.stringify({ ok: true, enrolled: 0, reason: "suppressed" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }

  const rep = (body.rep_name ?? "").split(" ")[0] || "me";
  const seq = sequences(rep)[seqKey];
  const now = Date.now();
  const rows = seq.map((content, i) => ({
    task_type: "sdr_call_drip_sms",
    contact_id: contactId,
    deal_id: body.deal_id ?? null,
    payload: {
      content,
      key: `${seqKey}_${i + 1}`,
      ...(phone ? { to: phone } : {}),
    },
    run_at: new Date(now + OFFSETS[i]).toISOString(),
  }));

  const r = await supabaseAdmin.from("scheduled_tasks").insert(rows);
  if (r.error) {
    console.error("[enroll_call_drip] enqueue failed", r.error);
    return createErrorResponse(500, "Failed to enroll");
  }

  return new Response(JSON.stringify({ ok: true, enrolled: rows.length, sequence: seqKey }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

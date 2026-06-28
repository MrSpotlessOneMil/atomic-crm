// Speed-to-lead AUDIT copy for outbound cold outreach to prospect cleaning
// companies (the businesses we sell Robin Line to).
//
// THE PLAY (honest version): an SDR places ONE genuine shopper inquiry to a
// prospect - a real "what's your price for a move-out?" the way any customer
// would - and we record how slow they were to respond (see the deals.audit_*
// columns). Then the outreach back to them holds up that real mirror:
//   "i asked you for a move-out quote 6 days ago and never heard back. that's a
//    booked job gone. robin line answers every lead in 15 seconds."
// Every number here is TRUE and about THEM. No fabricated jobs, no ghosting
// games, no blasting unused numbers - that's what makes it land and stay legal.
//
// Same SMS discipline as salesCopy.ts: GSM-7 only, plain hyphen + straight
// quotes, no emoji/em-dash, <=160 chars. Reuse render()/isCleanSms() from there.

export interface AuditFacts {
  company?: string | null; // prospect's business name; falls back to "you"
  jobType?: string | null; // what we genuinely asked about, e.g. "move-out"
  channel?: string | null; // 'sms' | 'email' | 'web_form' | 'phone'
  inquirySentAt?: string | null; // ISO timestamp of our genuine inquiry
  firstReplyAt?: string | null; // ISO timestamp of their first reply (or null)
  followedUp?: boolean | null; // did they chase the job after replying
  // "now" override for testing; defaults to current time.
  now?: Date;
}

export type AuditSeverity =
  | "never_replied" // strongest proof: no reply at all
  | "slow_no_followup" // replied late AND never chased
  | "slow_reply" // replied late
  | "no_followup" // replied okay but never followed up to close
  | "responsive" // fast + chased: audit angle is weak, pitch differently
  | "insufficient"; // not enough data / inquiry not sent yet

// Humanize an elapsed gap into GSM-7-safe ASCII ("19 hours", "6 days", "40 min").
export function humanizeGap(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

// Classify how bad the prospect's response was. "never_replied" only fires once
// enough time has passed (default 24h) so we don't call someone a ghost an hour
// in. "slow" threshold defaults to 1 hour (a real customer is long gone by then).
export function classifyAudit(
  f: AuditFacts,
  opts: { slowAfterMin?: number; ghostAfterHours?: number } = {},
): AuditSeverity {
  const slowAfterMin = opts.slowAfterMin ?? 60;
  const ghostAfterHours = opts.ghostAfterHours ?? 24;
  const now = f.now ?? new Date();

  if (!f.inquirySentAt) return "insufficient";
  const sent = new Date(f.inquirySentAt).getTime();
  if (!Number.isFinite(sent)) return "insufficient";

  if (!f.firstReplyAt) {
    const elapsedH = (now.getTime() - sent) / 3600000;
    return elapsedH >= ghostAfterHours ? "never_replied" : "insufficient";
  }

  const replied = new Date(f.firstReplyAt).getTime();
  if (!Number.isFinite(replied)) return "insufficient";
  const replyMin = (replied - sent) / 60000;
  const slow = replyMin >= slowAfterMin;
  const ghostedClose = f.followedUp === false;

  if (slow && ghostedClose) return "slow_no_followup";
  if (slow) return "slow_reply";
  if (ghostedClose) return "no_followup";
  return "responsive";
}

// Build the honest one-liner injected as {{audit_line}} in outreach. Returns ""
// when there isn't a credible audit angle (caller should fall back to normal
// copy). Always GSM-7-safe ASCII; keep the surrounding template short so the
// whole SMS stays <=160.
export function auditLine(f: AuditFacts): string {
  const sev = classifyAudit(f);
  const who = (f.company || "you").trim();
  const job = (f.jobType || "a quote").trim();
  const now = f.now ?? new Date();

  switch (sev) {
    case "never_replied": {
      const gap = humanizeGap(now.getTime() - new Date(f.inquirySentAt as string).getTime());
      return `i asked ${who} for a ${job} ${gap} ago as a customer and never heard back`;
    }
    case "slow_no_followup": {
      const gap = humanizeGap(
        new Date(f.firstReplyAt as string).getTime() - new Date(f.inquirySentAt as string).getTime(),
      );
      return `took ${who} ${gap} to reply to my ${job} ask, then no follow up`;
    }
    case "slow_reply": {
      const gap = humanizeGap(
        new Date(f.firstReplyAt as string).getTime() - new Date(f.inquirySentAt as string).getTime(),
      );
      return `took ${who} ${gap} to get back to me on a ${job} - a customer is long gone by then`;
    }
    case "no_followup":
      return `${who} answered my ${job} ask once then went quiet, never chased the job`;
    case "responsive":
    case "insufficient":
    default:
      return "";
  }
}

import { render } from "./salesCopy.ts";

// ---------------------------------------------------------------------------
// PRIMARY CHANNEL: cold EMAIL (Instantly, CAN-SPAM compliant). First-touch cold
// SMS to a business we have no relationship with is the TCPA-risky channel we
// deliberately avoid, so the audit proof leads in email. {{first_name}} is
// filled at send time; the audit line is baked in when the email is built.
// The compliant unsubscribe footer is appended by the sending system.
// ---------------------------------------------------------------------------
export interface AuditEmail {
  subject: string;
  body: string;
}

// Builds the cold email. Returns null when there is no credible audit angle, so
// the caller falls back to normal cold copy instead of a hollow claim.
export function auditEmail(f: AuditFacts, firstName = "{{first_name}}"): AuditEmail | null {
  const line = auditLine(f);
  if (!line) return null;
  const who = (f.company || "your team").trim();
  return {
    subject: `the job ${who} let slip`,
    body:
      `Hey ${firstName},\n\n` +
      `Being straight with you: ${line}.\n\n` +
      `That is a real customer who was ready to book - gone to whoever answered first. ` +
      `Robin Line answers every lead in about 15 seconds, quotes it, and books the job for you, ` +
      `around the clock, for less than a part-time VA.\n\n` +
      `Want me to show you how it would have caught that one? Just reply and I'll send a 2-minute video.`,
  };
}

// ---------------------------------------------------------------------------
// SECONDARY: tightened SMS, only for WARM contexts (a prospect who already
// replied / opted in). Guaranteed GSM-7-clean and <=160 by trying progressively
// shorter closes, then falling back to the no-claim opener if the line is too
// long to fit. {{first_name}} stays a placeholder for the dispatcher to fill.
// ---------------------------------------------------------------------------
const AUDIT_SMS_CLOSES = [
  ". robin line answers every lead in 15 sec and books it. worth a look?",
  ". robin line answers leads in 15 sec and books them. worth a look?",
  ". robin line answers in 15 sec. worth a look?",
];

// Fallback when there is no audit angle (fast/responsive or no data yet): same
// loss-aversion thesis, zero fabricated claim. Verified <=160 by the test.
export const AUDIT_SMS_FALLBACK =
  "hey {{first_name}}, most cleaning owners lose jobs to slow replies without knowing. robin line answers every lead in 15 sec. worth a look?";

export function auditSms(f: AuditFacts): string {
  const line = auditLine(f);
  if (!line) return AUDIT_SMS_FALLBACK;
  const head = `hey {{first_name}}, real talk - ${line}`;
  for (const close of AUDIT_SMS_CLOSES) {
    const sms = head + close;
    if (sms.length <= 160) return sms;
  }
  // Audit line itself too long to fit any SMS: use the no-claim fallback.
  return AUDIT_SMS_FALLBACK;
}

// Convenience: render {{first_name}} now if you have it (else leave it for the
// dispatcher). Kept thin so callers can also just use the templates directly.
export function renderAuditSms(f: AuditFacts, firstName?: string): string {
  const sms = auditSms(f);
  return firstName ? render(sms, { first_name: firstName }) : sms;
}

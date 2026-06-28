// Speed-to-lead AUDIT logic for the COLD-CALL play (frontend / SDR-facing).
//
// THE PLAY (honest): an SDR places ONE genuine shopper inquiry to a prospect
// cleaning company - a real "what's your price for a move-out?" the way any
// customer would - and logs how slow they were to respond (the deals.audit_*
// fields). On the call, the CRM hands the SDR that real slowness as a script:
//   "I called your shop as a customer 6 days ago and never heard back - that's
//    a booked job gone. Robin Line answers every lead in 15 seconds."
// Every number is TRUE and about THEM. No fabricated jobs, no ghosting games.
//
// This is the call-script twin of supabase/functions/_shared/auditCopy.ts (which
// handles automated cold EMAIL + warm SMS). Frontend and Deno edge fn are
// separate runtimes, so the pure classify logic is intentionally mirrored here.

import type { Deal } from "../types";

export type AuditSeverity =
  | "never_replied"
  | "slow_no_followup"
  | "slow_reply"
  | "no_followup"
  | "responsive"
  | "insufficient";

export interface AuditFacts {
  company?: string | null;
  jobType?: string | null;
  inquirySentAt?: string | null;
  firstReplyAt?: string | null;
  followedUp?: boolean | null;
  now?: Date;
}

// Pull the audit facts off a deal record (+ the prospect company name for copy).
export function auditFactsFromDeal(
  deal: Pick<
    Deal,
    | "audit_inquiry_sent_at"
    | "audit_first_reply_at"
    | "audit_followed_up"
    | "audit_job_type"
  >,
  companyName?: string | null,
): AuditFacts {
  return {
    company: companyName ?? null,
    jobType: deal.audit_job_type ?? null,
    inquirySentAt: deal.audit_inquiry_sent_at ?? null,
    firstReplyAt: deal.audit_first_reply_at ?? null,
    followedUp: deal.audit_followed_up ?? null,
  };
}

export function humanizeGap(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

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

// Short human label for the badge, e.g. "Never replied (6 days)" / "Slow: 19 hours".
export function auditGapLabel(f: AuditFacts): string {
  const sev = classifyAudit(f);
  const now = f.now ?? new Date();
  switch (sev) {
    case "never_replied":
      return `Never replied (${humanizeGap(now.getTime() - new Date(f.inquirySentAt as string).getTime())})`;
    case "slow_no_followup":
    case "slow_reply": {
      const gap = humanizeGap(
        new Date(f.firstReplyAt as string).getTime() - new Date(f.inquirySentAt as string).getTime(),
      );
      return sev === "slow_no_followup" ? `Slow + no follow-up (${gap})` : `Slow reply (${gap})`;
    }
    case "no_followup":
      return "Replied once, no follow-up";
    case "responsive":
      return "Responsive — use a different angle";
    case "insufficient":
    default:
      return "Not enough audit data yet";
  }
}

export interface CallScript {
  hook: string; // the mirror - their real slowness
  pivot: string; // the cost - a job walked
  ask: string; // the CTA - 2-min demo
}

// Build the spoken cold-call script from the audit. {{name}} is left for the SDR
// to say to whoever picks up. Returns null when there's no honest angle (fast /
// responsive prospect or no data) so the SDR leads with a normal opener instead.
export function auditCallScript(f: AuditFacts): CallScript | null {
  const sev = classifyAudit(f);
  const who = (f.company || "your shop").trim();
  const job = (f.jobType || "a quote").trim();
  const now = f.now ?? new Date();

  const pivot =
    "I'm not calling to bust your chops - that's just a real customer who was ready to book, gone to whoever answered first.";
  const ask =
    "I build the fix for exactly that: Robin Line answers every lead in about 15 seconds, quotes it, and books the job - 24/7, for less than a part-time VA. Can I show you in two minutes how it'd have caught mine?";

  switch (sev) {
    case "never_replied": {
      const gap = humanizeGap(now.getTime() - new Date(f.inquirySentAt as string).getTime());
      return {
        hook: `Hey {{name}}, being straight with you - I reached out to ${who} as a customer about a ${job} ${gap} ago and never heard back.`,
        pivot,
        ask,
      };
    }
    case "slow_no_followup": {
      const gap = humanizeGap(
        new Date(f.firstReplyAt as string).getTime() - new Date(f.inquirySentAt as string).getTime(),
      );
      return {
        hook: `Hey {{name}}, real talk - I asked ${who} for a ${job} as a customer, took ${gap} to hear back, and then nobody followed up.`,
        pivot,
        ask,
      };
    }
    case "slow_reply": {
      const gap = humanizeGap(
        new Date(f.firstReplyAt as string).getTime() - new Date(f.inquirySentAt as string).getTime(),
      );
      return {
        hook: `Hey {{name}}, honest reason I'm calling - I reached out to ${who} as a customer about a ${job} and it took ${gap} to get a reply. A customer's long gone by then.`,
        pivot,
        ask,
      };
    }
    case "no_followup":
      return {
        hook: `Hey {{name}}, quick honest one - I asked ${who} for a ${job} as a customer, got one reply, then it went quiet. Nobody chased the job.`,
        pivot,
        ask,
      };
    case "responsive":
    case "insufficient":
    default:
      return null;
  }
}

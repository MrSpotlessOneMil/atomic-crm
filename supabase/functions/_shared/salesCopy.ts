// SMS copy for the automated Robin Line sales funnel.
//
// Discipline (from robinline-1/docs/messaging-overhaul-spec.md):
//   * GSM-7 only — NO em-dash, curly quotes, emoji (they force UCS-2 / 70-char
//     segments and tank deliverability). Use plain hyphen, straight quotes.
//   * Keep each message <=160 chars INCLUDING the opt-out line.
//   * Every first/standalone message carries opt-out language.
//
// Merge fields: {{first_name}} (filled by the dispatcher at send time),
// {{rep_name}} (pre-rendered at enqueue time from SALES_AGENT_NAME).
//
// Copy here is research-backed scaffolding; final wording is Dominic's call.

export const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
export const GSM7_EXT = "^{}\\[~]|€";

// Returns the characters that would force UCS-2 (i.e. are NOT GSM-7).
export function nonGsm7(s: string): string[] {
  const bad: string[] = [];
  for (const ch of s) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXT.includes(ch)) bad.push(ch);
  }
  return [...new Set(bad)];
}

// True when the message is GSM-7-clean AND fits one 160-char segment.
export function isCleanSms(s: string): boolean {
  return nonGsm7(s).length === 0 && s.length <= 160;
}

// Replaces only the placeholders present in `vars`; leaves any others intact so
// the dispatcher can fill {{first_name}} later at send time.
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : _m,
  );
}

// First touch — fired the instant a lead opts in (speed-to-lead). Opens a
// qualifying conversation; the AI agent takes over on the reply.
export const OPENER =
  "Hey {{first_name}}, it's {{rep_name}} at Robin Line. Just sent {{lead_magnet}}! Quick q to point you right: residential, commercial, or both? Txt STOP to opt out.";

// Multi-touch nurture for leads who never reply. Cancelled on any inbound.
// Offsets are minutes from opt-in. Ends on a breakup (highest reply rate).
export interface NurtureStep {
  key: string;
  offsetMinutes: number;
  template: string;
}

export const NURTURE: NurtureStep[] = [
  {
    key: "nudge_1h",
    offsetMinutes: 60,
    template:
      "{{first_name}}, still want to see how Robin Line books cleanings 24/7? 15 min. This week or next? Txt STOP to stop.",
  },
  {
    key: "nudge_1d",
    offsetMinutes: 60 * 24,
    template:
      "Hey {{first_name}}, Robin Line answers every lead in seconds so you stop losing jobs to slow replies. Quick demo? Txt STOP to stop.",
  },
  {
    key: "nudge_3d",
    offsetMinutes: 60 * 24 * 3,
    template:
      "{{first_name}}, owners on Robin Line book more jobs without hiring a VA. Worth 15 min on your numbers? Txt STOP to stop.",
  },
  {
    key: "nudge_7d",
    offsetMinutes: 60 * 24 * 7,
    template:
      "Still there {{first_name}}? Can send a 2-min video instead of a call if easier. Want it? Txt STOP to stop.",
  },
  {
    key: "breakup_14d",
    offsetMinutes: 60 * 24 * 14,
    template:
      "{{first_name}}, closing your file so I stop texting. Want Robin Line to run your booking? Just reply here. All the best. STOP to stop.",
  },
];

// Demo reminder cadence (scheduled when Calendly confirms a booking). Offsets
// are minutes BEFORE the demo; the first asks for an explicit confirm.
export interface ReminderStep {
  key: string;
  minutesBefore: number;
  template: string;
}

export const REMINDERS: ReminderStep[] = [
  {
    key: "reminder_24h",
    minutesBefore: 60 * 24,
    template:
      "{{first_name}}, your Robin Line demo is tomorrow at {{demo_time}}. Reply C to confirm or R to reschedule. Txt STOP to stop.",
  },
  {
    key: "reminder_morning",
    minutesBefore: 60 * 3, // resolved to ~8am local by the scheduler
    template:
      "Morning {{first_name}}! Your Robin Line demo is today at {{demo_time}}. See you then - reply R to reschedule. Txt STOP to stop.",
  },
  {
    key: "reminder_1h",
    minutesBefore: 60,
    template:
      "{{first_name}}, your Robin Line demo is in 1 hour ({{demo_time}}). Here's the link: {{join_link}}. Txt STOP to stop.",
  },
];

// Sent right after a missed demo to recover the no-show.
export const NO_SHOW =
  "{{first_name}}, sorry we missed you for the Robin Line demo! Want to grab another time? {{calendly_link}} Txt STOP to stop.";

// ---------------------------------------------------------------------------
// WARM EMAIL drip for lead-magnet opt-ins who gave an email. Sent from the
// closer's Gmail (see _shared/leadEmail.ts) — warm + 1:1, NOT the cold Instantly
// campaign. Plain text. {{first_name}} filled at send time. Each carries a soft
// opt-out (CAN-SPAM). Longer/softer than SMS since it's email.
// ---------------------------------------------------------------------------
export interface EmailStep {
  key: string;
  offsetMinutes: number;
  subject: string;
  body: string;
}

const EMAIL_SIGNOFF =
  "\n\n- {{rep_name}}, Robin Line\nRobin Line, 24 Tamalpais Ave, Mill Valley, CA 94941\nNot useful? Just reply \"stop\" and I won't email again.";

// First email — fired on opt-in (alongside the speed-to-lead SMS when there is
// also a phone; on its own when the lead is email-only).
export const EMAIL_OPENER: EmailStep = {
  key: "email_opener",
  offsetMinutes: 0,
  subject: "your Robin Line templates",
  body:
    "Hey {{first_name}},\n\nThanks for grabbing {{lead_magnet}} - it's a solid start.\n\n" +
    "Quick context: Robin Line is the AI back office for cleaning companies - it answers every lead, quotes fast, books the job, and chases the money 24/7, for less than a part-time VA.\n\n" +
    "Worth a quick look at how it'd run for you? Just reply and I'll send a 2-minute video." +
    EMAIL_SIGNOFF,
};

export const EMAIL_NURTURE: EmailStep[] = [
  {
    key: "email_1d",
    offsetMinutes: 60 * 24,
    subject: "the part owners like most",
    body:
      "Hey {{first_name}},\n\nThe thing owners tell us they love: Robin Line goes back through dead quotes and unpaid balances and revives them automatically. Most shops are sitting on thousands in jobs that never got a second touch.\n\n" +
      "Want me to show you how it'd work on your business? Reply and I'll set it up." +
      EMAIL_SIGNOFF,
  },
  {
    key: "email_4d",
    offsetMinutes: 60 * 24 * 4,
    subject: "10 hours a week back",
    body:
      "{{first_name}}, a cleaning company about your size was missing roughly 1 in 3 after-hours leads and following up by hand. Robin Line now answers instantly, books the job, and chases the invoice - the owner got about 10 hours a week back.\n\n" +
      "Happy to show you the same setup. Want a quick walkthrough?" +
      EMAIL_SIGNOFF,
  },
  {
    key: "email_10d",
    offsetMinutes: 60 * 24 * 10,
    subject: "closing your file",
    body:
      "{{first_name}}, I'll stop here so I'm not cluttering your inbox.\n\nIf running intake, dispatch, and collections by hand is working fine, no worries. If it's eating your nights, that's the one thing Robin Line takes off your plate - just reply and we'll talk." +
      EMAIL_SIGNOFF,
  },
];

// SMS copy for the automated Robin Line sales funnel.
//
// VOICE: these read like a real person named "robin" texting one-to-one - lower
// case, casual, contractions, one question, never salesy. The lead should feel
// like a human reached out, not an automation.
//
// Discipline:
//   * GSM-7 only. NO em-dash ever, no curly quotes, no emoji (they force UCS-2 /
//     70-char segments and tank deliverability). Plain hyphen + straight quotes.
//   * Keep each message <=160 chars.
//   * NO advertised opt-out line ("Txt STOP ...") in SMS. Compliance is enforced
//     in code: quo_inbound's STOP_RE suppresses anyone who texts stop/unsub/etc.
//     (Email keeps a soft CAN-SPAM opt-out below - that's legally required.)
//
// Merge fields: {{first_name}} (filled by the dispatcher at send time),
// {{lead_magnet}} (what they grabbed). The sender name "robin" is written inline.
//
// Copy here is scaffolding; final wording is Dominic's call.

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

// First touch - fired the instant a lead opts in (speed-to-lead). Opens a
// qualifying conversation; the AI agent takes over on the reply.
export const OPENER =
  "hey {{first_name}}, robin here from robin line. just sent over {{lead_magnet}}. you running a cleaning crew right now or just getting started?";

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
      "{{first_name}}, still want to see how robin line books cleanings for you around the clock? takes about 15 min. this week work?",
  },
  {
    key: "nudge_1d",
    offsetMinutes: 60 * 24,
    template:
      "hey {{first_name}}, most owners i talk to are losing jobs to slow replies. robin line answers every lead in seconds. worth a quick look?",
  },
  {
    key: "nudge_3d",
    offsetMinutes: 60 * 24 * 3,
    template:
      "{{first_name}}, owners on robin line book more jobs without hiring a VA. want me to show you on your own numbers? only takes 15",
  },
  {
    key: "nudge_7d",
    offsetMinutes: 60 * 24 * 7,
    template:
      "still around {{first_name}}? i can send a quick 2 min video instead of hopping on a call if that's easier. want me to?",
  },
  {
    key: "breakup_14d",
    offsetMinutes: 60 * 24 * 14,
    template:
      "{{first_name}}, i'll stop bugging you. if you ever want robin line running your booking just text me back. take care",
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
      "hey {{first_name}}, we're on for tomorrow at {{demo_time}} for your robin line walkthrough. still good? reply c to confirm or r to move it",
  },
  {
    key: "reminder_morning",
    minutesBefore: 60 * 3, // resolved to ~8am local by the scheduler
    template:
      "morning {{first_name}}! we're set for today at {{demo_time}}. talk soon. reply r if you need to move it",
  },
  {
    key: "reminder_1h",
    minutesBefore: 60,
    template:
      "{{first_name}}, see you in an hour at {{demo_time}}. here's the link: {{join_link}}",
  },
];

// Sent right after a missed demo to recover the no-show.
export const NO_SHOW =
  "hey {{first_name}}, looks like we missed each other earlier. want to grab another time? {{calendly_link}}";

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

// Six touches over a month (email drives real replies - one manual blast to the
// list booked multiple demos), ending on the breakup at day 30.
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
    subject: "what a slow reply costs",
    body:
      "{{first_name}}, quick math we run with owners: if a missed or slow-answered lead is worth ~$300 and you miss even 3 a week, that's roughly $45k a year walking to whoever answered first.\n\n" +
      "Robin Line answers every lead in seconds, 24/7. Want me to run the same math on your numbers? Just reply with roughly how many leads you get a week." +
      EMAIL_SIGNOFF,
  },
  {
    key: "email_14d",
    offsetMinutes: 60 * 24 * 14,
    subject: "2-minute video instead?",
    body:
      "{{first_name}}, if a call feels like too much right now, I can send a 2-minute video of Robin Line answering a lead, quoting, and booking the job on its own - no meeting needed.\n\n" +
      "Want the video? Just reply \"video\" and it's yours." +
      EMAIL_SIGNOFF,
  },
  {
    key: "email_21d",
    offsetMinutes: 60 * 24 * 21,
    subject: "the setup is on us",
    body:
      "{{first_name}}, the two things owners worry about before trying Robin Line: \"I don't have time to set it up\" (we do the setup with you, most are live in under a week) and \"my customers won't like it\" (they just get instant answers and easy booking - most never realize it isn't you).\n\n" +
      "If either of those was your hesitation, want a quick look?" +
      EMAIL_SIGNOFF,
  },
  {
    key: "email_30d",
    offsetMinutes: 60 * 24 * 30,
    subject: "closing your file",
    body:
      "{{first_name}}, I'll stop here so I'm not cluttering your inbox.\n\nIf running intake, dispatch, and collections by hand is working fine, no worries. If it's eating your nights, that's the one thing Robin Line takes off your plate - just reply and we'll talk." +
      EMAIL_SIGNOFF,
  },
];

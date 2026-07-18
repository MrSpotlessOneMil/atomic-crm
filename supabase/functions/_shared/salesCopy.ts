// SMS + email copy for the automated Robin Line sales funnel.
//
// CADENCE SOURCE: the Hormozi playbook doc ("RobinLine Followup Sequences" —
// $100M Lead Nurture / Closing playbooks). Day 1 gets three texts (opener,
// engagement question, time A/B), days 2-7 get one per day rotating the close
// (proof, 1-to-10, bump, best/worst case, reason, video), day 10 is the honest
// close-out, then long-term nurture (the 9-word re-engagement + the 90-day
// proof drop). Emails: opener at minute 0, day-3 replied IN THE SAME THREAD,
// day-8 "Are you busy..?". The call cadence lives in callCadence.ts and already
// matches the playbook's volume protocol.
//
// VOICE: these read like a real person named "robin" texting one-to-one - lower
// case, casual, contractions, one question, never salesy. The lead should feel
// like a human reached out, not an automation.
//
// Discipline:
//   * GSM-7 only. NO em-dash ever, no curly quotes, no emoji (they force UCS-2 /
//     70-char segments and tank deliverability). Plain hyphen + straight quotes.
//     Spanish copy is written accent-light (dias, ingles) because a/i/o/u with
//     acute accents are NOT GSM-7; ñ, é and ¿ are, so mañana / qué / ¿...? stay.
//   * Keep each message <=160 chars (the opener may run to 2 segments because
//     it carries the one-time opt-out line; that's a compliance requirement).
//   * The FIRST text carries "reply stop to opt out" ONCE (playbook + A2P 10DLC
//     hygiene); after that the line is dropped. quo_inbound's STOP_RE enforces
//     it (plus ALTO for Spanish), and provider-side opt-outs are mirrored into
//     sms_suppressions by the dispatcher.
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

export type Lang = "en" | "es";

// One-time opt-out line, appended to the FIRST text only (see enrollment.ts).
export const STOP_LINE: Record<Lang, string> = {
  en: "reply stop to opt out",
  es: "responde stop para no recibir mas mensajes",
};

// First touch - fired the instant a lead opts in (speed-to-lead). Opens a
// qualifying conversation; the AI agent takes over on the reply.
export const OPENER =
  "hey {{first_name}}, robin here from robin line. just sent over {{lead_magnet}}. you running a cleaning crew right now or just getting started?";

export const OPENER_ES =
  "hola {{first_name}}, soy robin de robin line. te acabo de mandar {{lead_magnet}}. ¿tienes equipo de limpieza o apenas empiezas?";

// Multi-touch nurture for leads who never reply. Cancelled on any inbound
// (SMS, email reply, or a real phone conversation - see haltFollowup.ts).
// Offsets are minutes from opt-in. Playbook rhythm: three touches on day 1,
// then one a day through day 7, close-out on day 10.
export interface NurtureStep {
  key: string;
  offsetMinutes: number;
  template: string;
}

const MIN_H = 60;
const MIN_D = 60 * 24;

export const NURTURE: NurtureStep[] = [
  {
    // Playbook Text 2, the engagement ("shirt color") question: ANY answer
    // restarts the conversation, and responders show up.
    key: "nudge_engage",
    offsetMinutes: Math.round(3.5 * MIN_H),
    template:
      "quick q while i set up your file - when mary picks up your missed calls, you want her answering in english, spanish, or both?",
  },
  {
    // Playbook Text 3, the evening time A/B (both options assume yes).
    key: "nudge_timeab",
    offsetMinutes: 8 * MIN_H,
    template:
      "last one for today, promise :) i've got tomorrow at 9am or 4:30pm open for your 15 min setup call. morning or afternoon?",
  },
  {
    // Day 2: proof (real client story).
    key: "nudge_proof_2d",
    offsetMinutes: 1 * MIN_D,
    template:
      "{{first_name}}, one of our cleaning clients turned mary on and now wakes up to bookings that came in overnight while he slept. want to see it for your biz? 15 min",
  },
  {
    // Day 3: the 1-to-10 close.
    key: "nudge_1to10_3d",
    offsetMinutes: 2 * MIN_D,
    template:
      "real quick, 1 to 10 - how serious are you about automating your business right now? whatever the number, i'll point you the right way",
  },
  {
    // Day 4: bump.
    key: "nudge_bump_4d",
    offsetMinutes: 3 * MIN_D,
    template:
      "hey {{first_name}}, just bumping this up :) free today, or tomorrow morning, for 7 minutes?",
  },
  {
    // Day 5: best case / worst case + risk reversal.
    key: "nudge_bestworst_5d",
    offsetMinutes: 4 * MIN_D,
    template:
      "just so you know - the trial is 14 days, free, no card. worst case you walk away with free tips. best case your jobs start booking themselves. turn it on?",
  },
  {
    // Day 6: the "reason" close, kept playful.
    key: "nudge_reason_6d",
    offsetMinutes: 5 * MIN_D,
    template:
      "i get it, you're slammed. but being too busy to answer this text is exactly the problem robin line kills :) 15 min and it's off your plate. today or tomorrow?",
  },
  {
    // Day 7: go personal - offer the 60-second video / voice memo.
    key: "nudge_video_7d",
    offsetMinutes: 6 * MIN_D,
    template:
      "hey {{first_name}}, instead of another text i can send you 60 seconds of what mary actually says when a customer calls while you're on a job. want it?",
  },
  {
    // Day 10: honest close-out (door stays open).
    key: "closeout_10d",
    offsetMinutes: 9 * MIN_D,
    template:
      "i'll stop blowing up your phone after this one :) if now's not the time, all good. want the free 14 day trial? reply yes and i'll set you up today",
  },
];

export const NURTURE_ES: NurtureStep[] = [
  {
    key: "nudge_engage",
    offsetMinutes: Math.round(3.5 * MIN_H),
    template:
      "pregunta rapida mientras preparo tu cuenta - cuando mary conteste tus llamadas perdidas, ¿quieres que hable español, ingles, o los dos?",
  },
  {
    key: "nudge_timeab",
    offsetMinutes: 8 * MIN_H,
    template:
      "ultimo de hoy, lo prometo :) tengo mañana a las 9am o 4:30pm para tu llamada de 15 min. ¿en la mañana o en la tarde?",
  },
  {
    key: "nudge_proof_2d",
    offsetMinutes: 1 * MIN_D,
    template:
      "{{first_name}}, uno de nuestros clientes de limpieza activo a mary y ahora se despierta con trabajos que entraron de noche mientras dormia. ¿te lo enseño? 15 min",
  },
  {
    key: "nudge_1to10_3d",
    offsetMinutes: 2 * MIN_D,
    template:
      "rapidito, del 1 al 10 - ¿que tan en serio quieres automatizar tu negocio ahorita? sea cual sea el numero, te digo el mejor camino",
  },
  {
    key: "nudge_bump_4d",
    offsetMinutes: 3 * MIN_D,
    template:
      "hola {{first_name}}, nomas para que no se pierda esto :) ¿tienes 7 minutos hoy, o mañana en la mañana?",
  },
  {
    key: "nudge_bestworst_5d",
    offsetMinutes: 4 * MIN_D,
    template:
      "para que sepas - la prueba es de 14 dias, gratis, sin tarjeta. en el peor caso te llevas tips gratis. en el mejor, tus trabajos se agendan solos. ¿te la activo?",
  },
  {
    key: "nudge_reason_6d",
    offsetMinutes: 5 * MIN_D,
    template:
      "te entiendo, andas a mil. pero estar tan ocupado que no puedes ni contestar es justo lo que robin line elimina :) 15 min y te lo quito. ¿hoy o mañana?",
  },
  {
    key: "nudge_video_7d",
    offsetMinutes: 6 * MIN_D,
    template:
      "hola {{first_name}}, en vez de otro mensaje te puedo mandar 60 segundos de lo que mary dice cuando un cliente llama mientras trabajas. ¿te lo mando?",
  },
  {
    key: "closeout_10d",
    offsetMinutes: 9 * MIN_D,
    template:
      "despues de este ya no te lleno el telefono :) si no es el momento, todo bien. ¿quieres la prueba gratis de 14 dias? responde si y te la activo hoy",
  },
];

// Long-term nurture (playbook day 11+): the 9-word re-engagement and the 90-day
// social-proof drop. Same nurture_sms task type, so booking / any reply / STOP
// cancels them exactly like the front cadence.
export const LONGTERM_SMS: NurtureStep[] = [
  {
    key: "nineword_35d",
    offsetMinutes: 35 * MIN_D,
    template: "are you still looking to automate your cleaning business?",
  },
  {
    key: "proof_90d",
    offsetMinutes: 90 * MIN_D,
    template:
      "a cleaning company that started around when you first reached out now has mary booking jobs on autopilot. not too late to catch up - want the free trial?",
  },
];

export const LONGTERM_SMS_ES: NurtureStep[] = [
  {
    key: "nineword_35d",
    offsetMinutes: 35 * MIN_D,
    template: "¿sigues buscando automatizar tu negocio de limpieza?",
  },
  {
    key: "proof_90d",
    offsetMinutes: 90 * MIN_D,
    template:
      "una empresa de limpieza que empezo por las fechas en que nos escribiste ya tiene a mary agendando sus trabajos solita. no es tarde - ¿quieres la prueba gratis?",
  },
];

// Demo reminder cadence (scheduled when a booking is confirmed). Offsets are
// minutes BEFORE the demo. Playbook: instant confirmation (labeled automated,
// scheduled separately - see CONFIRMATION), then 24h / 12h / 3h, plus the 1h
// join-link text.
export interface ReminderStep {
  key: string;
  minutesBefore: number;
  template: string;
}

export const REMINDERS: ReminderStep[] = [
  {
    key: "reminder_24h",
    minutesBefore: 24 * 60,
    template:
      "hey {{first_name}}, we're on for tomorrow at {{demo_time}} for your robin line walkthrough. still good? reply c to confirm or r to move it",
  },
  {
    key: "reminder_12h",
    minutesBefore: 12 * 60,
    template:
      "{{first_name}}, quick heads up - we're set for {{demo_time}}. anything specific you want me to look at for your business before we talk? just reply here",
  },
  {
    key: "reminder_3h",
    minutesBefore: 3 * 60,
    template:
      "hey {{first_name}}, we're on for today at {{demo_time}}. talk soon. reply r if you need to move it",
  },
  {
    key: "reminder_1h",
    minutesBefore: 60,
    template:
      "{{first_name}}, see you in an hour at {{demo_time}}.{{join_line}}",
  },
];

// Spanish booked flow (confirmation + reminders + no-show), so a lead who ran
// the ES drip isn't suddenly texted in English the moment they book.
export const REMINDERS_ES: ReminderStep[] = [
  {
    key: "reminder_24h",
    minutesBefore: 24 * 60,
    template:
      "hola {{first_name}}, quedamos mañana a las {{demo_time}} para tu demo de robin line. ¿sigue en pie? responde c para confirmar o r para moverla",
  },
  {
    key: "reminder_12h",
    minutesBefore: 12 * 60,
    template:
      "{{first_name}}, recordatorio - quedamos a las {{demo_time}}. ¿hay algo de tu negocio que quieras que revise antes de hablar? responde aqui",
  },
  {
    key: "reminder_3h",
    minutesBefore: 3 * 60,
    template:
      "hola {{first_name}}, hoy a las {{demo_time}} tenemos tu demo. hablamos pronto. responde r si necesitas moverla",
  },
  {
    key: "reminder_1h",
    minutesBefore: 60,
    template:
      "{{first_name}}, nos vemos en una hora a las {{demo_time}}.{{join_line}}",
  },
];

// Instant booking confirmation (playbook "show-rate stack": automated, honest
// about being automated, invites a reply). Sent the moment a booking lands.
export const CONFIRMATION =
  "robin line - confirmed for {{demo_time}}. we'll call you from this number. this confirmation is automated but i'm real, reply anytime";

export const CONFIRMATION_ES =
  "robin line - confirmado para {{demo_time}}. te llamamos desde este numero. esta confirmacion es automatica pero soy real, responde cuando quieras";

// Sent right after a missed demo to recover the no-show.
export const NO_SHOW =
  "hey {{first_name}}, looks like we missed each other earlier. want to grab another time? {{calendly_link}}";

export const NO_SHOW_ES =
  "hola {{first_name}}, parece que no coincidimos hoy. ¿quieres apartar otra hora? {{calendly_link}}";

// ---------------------------------------------------------------------------
// WARM EMAIL drip. Playbook: 3 emails, not 7 - the opener at minute 0, the
// day-3 bump replied INSIDE the opener's thread (threadWith), and the day-8
// "Are you busy..?". Long-term: the 9-word re-engagement for email-only leads.
// Sent from the closer's Gmail (see _shared/leadEmail.ts) — warm + 1:1, NOT the
// cold Instantly campaign. Plain text. {{first_name}} filled at send time. Each
// carries a soft opt-out (CAN-SPAM) — and email_suppressions now enforces it.
// ---------------------------------------------------------------------------
export interface EmailStep {
  key: string;
  offsetMinutes: number;
  subject: string;
  body: string;
  threadWith?: string; // key of the earlier email to reply-thread into
}

const EMAIL_SIGNOFF =
  '\n\n- {{rep_name}}, Robin Line\nRobin Line, 24 Tamalpais Ave, Mill Valley, CA 94941\nNot useful? Just reply "stop" and I won\'t email again.';

const EMAIL_SIGNOFF_ES =
  '\n\n- {{rep_name}}, Robin Line\nRobin Line, 24 Tamalpais Ave, Mill Valley, CA 94941\n¿No es util? Solo responde "stop" y no te escribo mas.';

// Email 1 — fired on opt-in (alongside the speed-to-lead SMS when there is
// also a phone; on its own when the lead is email-only). Playbook Day-1 email:
// big fast value, matched proof, one clear CTA, the honest P.S.
export const EMAIL_OPENER: EmailStep = {
  key: "email_opener",
  offsetMinutes: 0,
  subject: "{{first_name}} <> Robin Line",
  body:
    "Hey {{first_name}},\n\n{{opener_context}}\n\n" +
    "Here's what happens next if you want it: we hop on a 15-minute call, and by the end of it your AI receptionist is live on your line. She answers missed calls and texts in English AND Spanish, quotes from YOUR price list, and books jobs onto your calendar. You watch her take her first call before we hang up.\n\n" +
    "We run this for cleaning companies from Los Angeles to Cedar Rapids to Texas, including our own cleaning company here in LA. One of our owners literally wakes up to confirmed bookings that came in overnight.\n\n" +
    "It's free for 14 days. No card.\n\n" +
    "Grab a time (today and tomorrow are open): {{calendly_link}}\nOr just reply with a time and I'll call you." +
    EMAIL_SIGNOFF +
    '\n\nP.S. Reply "no" if you\'d rather not hear from me. No hard feelings.',
};

export const EMAIL_OPENER_ES: EmailStep = {
  key: "email_opener",
  offsetMinutes: 0,
  subject: "{{first_name}} <> Robin Line",
  body:
    "Hola {{first_name}},\n\n{{opener_context}}\n\n" +
    "Esto es lo que sigue si lo quieres: hacemos una llamada de 15 minutos, y antes de colgar tu recepcionista con IA ya esta activa en tu linea. Contesta llamadas perdidas y mensajes en español E ingles, cotiza con TUS precios, y agenda trabajos en tu calendario. La ves tomar su primera llamada en vivo.\n\n" +
    "Hacemos esto para empresas de limpieza desde Los Angeles hasta Texas, incluyendo nuestra propia empresa de limpieza aqui en LA. Uno de nuestros dueños literalmente se despierta con trabajos confirmados que entraron durante la noche.\n\n" +
    "Es gratis por 14 dias. Sin tarjeta.\n\n" +
    "Aparta tu espacio (hay lugar hoy y mañana): {{calendly_link}}\nO simplemente responde con una hora y yo te llamo." +
    EMAIL_SIGNOFF_ES +
    '\n\nP.D. Responde "no" si prefieres que ya no te escriba. Sin problema.',
};

// Emails 2 + 3. Email 2 threads into Email 1 (playbook: "replied INSIDE the
// same thread"); Email 3 is the day-8 "Are you busy..?" as a fresh thread.
export const EMAIL_NURTURE: EmailStep[] = [
  {
    key: "email_bump_3d",
    offsetMinutes: 2 * MIN_D,
    threadWith: "email_opener",
    subject: "Re: {{first_name}} <> Robin Line",
    body: "Friendly follow-up. Do you still plan to get your business's calls, quotes, and bookings off your plate this year? If so, we should definitely talk.\n\nWhat's tomorrow like for you?\n\n- {{rep_name}}",
  },
  {
    key: "email_busy_8d",
    offsetMinutes: 7 * MIN_D,
    subject: "Are you busy..?",
    body:
      "Hey {{first_name}}, me again. Considering this is the 3rd email, I'm sure you're busy. (Honestly? That's good.)\n\n" +
      "Problem: if you plan to grow your business this year, every missed call and slow quote is a job going to the next company on the list. And chasing the rest eats your nights.\n\n" +
      "Solution: give me 15 minutes. We set up your free 14-day trial live on the call, and Mary starts answering, quoting, and booking that same day, in English and Spanish.\n\n" +
      "Tell me a time and I'll make it happen. Or book direct: {{calendly_link}}" +
      EMAIL_SIGNOFF,
  },
];

export const EMAIL_NURTURE_ES: EmailStep[] = [
  {
    key: "email_bump_3d",
    offsetMinutes: 2 * MIN_D,
    threadWith: "email_opener",
    subject: "Re: {{first_name}} <> Robin Line",
    body: "Seguimiento amistoso. ¿Sigues con el plan de quitarte de encima las llamadas, cotizaciones y citas de tu negocio este año? Si si, definitivamente hay que hablar.\n\n¿Como andas mañana?\n\n- {{rep_name}}",
  },
  {
    key: "email_busy_8d",
    offsetMinutes: 7 * MIN_D,
    subject: "¿Andas ocupado..?",
    body:
      "Hola {{first_name}}, otra vez yo. Como este es el tercer correo, seguro andas ocupado. (¿La verdad? Eso es buena señal.)\n\n" +
      "Problema: si planeas hacer crecer tu negocio este año, cada llamada perdida y cada cotizacion lenta es un trabajo que se va con la siguiente empresa de la lista. Y perseguir a los demas te come las noches.\n\n" +
      "Solucion: dame 15 minutos. Activamos tu prueba gratis de 14 dias en vivo durante la llamada, y Mary empieza a contestar, cotizar y agendar ese mismo dia, en español e ingles.\n\n" +
      "Dime una hora y lo hago realidad. O agenda directo: {{calendly_link}}" +
      EMAIL_SIGNOFF_ES,
  },
];

// Long-term nurture over email — used for EMAIL-ONLY leads (leads with a phone
// get the SMS versions; doubling both channels on the same day reads like a
// blast, not a person).
export const LONGTERM_EMAIL: EmailStep[] = [
  {
    key: "nineword_35d",
    offsetMinutes: 35 * MIN_D,
    subject: "quick question",
    body: "Are you still looking to automate your cleaning business?\n\n- {{rep_name}}",
  },
  {
    key: "proof_90d",
    offsetMinutes: 90 * MIN_D,
    subject: "not too late",
    body:
      "Remember when you first reached out? A cleaning company that started around that same week now has Mary booking their jobs automatically.\n\nNot too late to catch up - want the free trial? Just reply YES." +
      EMAIL_SIGNOFF,
  },
];

export const LONGTERM_EMAIL_ES: EmailStep[] = [
  {
    key: "nineword_35d",
    offsetMinutes: 35 * MIN_D,
    subject: "pregunta rapida",
    body: "¿Sigues buscando automatizar tu negocio de limpieza?\n\n- {{rep_name}}",
  },
  {
    key: "proof_90d",
    offsetMinutes: 90 * MIN_D,
    subject: "no es tarde",
    body:
      "¿Te acuerdas cuando nos escribiste? Una empresa de limpieza que empezo por esas mismas fechas ya tiene a Mary agendando sus trabajos solita.\n\nNo es tarde para alcanzarlos - ¿quieres la prueba gratis? Solo responde SI." +
      EMAIL_SIGNOFF_ES,
  },
];

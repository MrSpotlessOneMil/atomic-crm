// Premade, natural first-touch follow-ups keyed by the call outcome picked in
// the Log Call dialog. The rep can send as-is, edit, delete and write their own,
// or hit "Draft with AI" to refine. Tone is plain and human on purpose — no hard
// Robin Line pitch (see feedback: message draft tone).

export type OutcomeCopy = {
  /** Ready-to-send SMS body. */
  sms: string;
  /** Ready-to-send email subject + body. */
  emailSubject: string;
  emailBody: string;
  /** One-line context handed to the AI draft prompt so refinements stay on-message. */
  aiHint: string;
  /** Whether it makes sense to auto-prompt a reach-out for this outcome. */
  reachOut: boolean;
};

// firstName = the lead's first name (fallback "there"); repName = the SDR.
export const buildOutcomeCopy = (
  outcome: string | undefined,
  firstName: string,
  repName: string,
): OutcomeCopy | null => {
  const f = (firstName || "").trim() || "there";
  const r = (repName || "").trim() || "me";

  switch (outcome) {
    case "No answer":
      return {
        sms: `Hi ${f}, it's ${r} — gave you a call just now and missed you. When's a good time to connect? Happy to work around your schedule.`,
        emailSubject: "Tried to reach you today",
        emailBody: `Hi ${f},\n\nThis is ${r} — I tried giving you a call today but couldn't get through. I'd love to grab a few minutes whenever it's convenient. What time works best for you?\n\nThanks,\n${r}`,
        aiHint: "The rep called but got no answer; this is a friendly nudge to find a time to talk.",
        reachOut: true,
      };
    case "Left voicemail":
      return {
        sms: `Hi ${f}, ${r} here — just left you a quick voicemail. Whenever you get a sec, give me a shout back or just reply here. Thanks!`,
        emailSubject: "Left you a voicemail",
        emailBody: `Hi ${f},\n\nThis is ${r} — I just left you a quick voicemail. Whenever you have a moment, feel free to call me back or simply reply to this email. No rush.\n\nThanks,\n${r}`,
        aiHint: "The rep left a voicemail; this is a light follow-up so the lead has an easy way to respond.",
        reachOut: true,
      };
    case "Gatekeeper":
      return {
        sms: `Hi, this is ${r} — trying to reach whoever handles new business for ${f}. Who's the best person, and when's a good time to catch them?`,
        emailSubject: "Quick question",
        emailBody: `Hi,\n\nThis is ${r} — I'm trying to reach the right person about new business. Could you point me to who handles that and the best way to reach them?\n\nThank you,\n${r}`,
        aiHint: "The rep reached a gatekeeper, not the decision-maker; this politely asks for the right contact.",
        reachOut: true,
      };
    case "Call back later":
      return {
        sms: `Hi ${f}, ${r} here — thanks for the quick chat. I'll follow up when you said works better. If anything changes in the meantime, just text me here.`,
        emailSubject: "Following up soon",
        emailBody: `Hi ${f},\n\nThanks for taking my call — I know the timing wasn't ideal. I'll circle back when you mentioned works better. In the meantime, feel free to reach me here anytime.\n\nTalk soon,\n${r}`,
        aiHint: "The lead asked to be called back later; keep it warm and confirm you'll follow up.",
        reachOut: true,
      };
    case "Asked to email":
      return {
        sms: `Hi ${f}, ${r} here — just sent that info over to your email like you asked. Give it a look and reply here if anything's easier by text.`,
        emailSubject: `The info you asked for, ${f}`,
        emailBody: `Hi ${f},\n\nGreat talking with you — as requested, here's a quick note with the details. Take a look whenever you get a chance, and just reply here with any questions.\n\nBest,\n${r}`,
        aiHint: "The lead asked to be emailed the details; this is that email — clear and helpful, not pushy.",
        reachOut: true,
      };
    case "Interested":
      return {
        sms: `Hi ${f}, really enjoyed chatting just now! Happy to show you how this could work for you. Want me to send over a couple times for a quick walkthrough?`,
        emailSubject: "Great talking with you",
        emailBody: `Hi ${f},\n\nReally enjoyed our conversation — thanks for the interest. I'd love to walk you through how this could fit your business. Are there a couple of times this week that work for a quick call?\n\nLooking forward to it,\n${r}`,
        aiHint: "The lead is interested; move toward booking a quick walkthrough without being heavy-handed.",
        reachOut: true,
      };
    case "Booked!":
      return {
        sms: `Hi ${f}, awesome — you're all set! Looking forward to it. I'll send a reminder beforehand; if anything comes up just text me here.`,
        emailSubject: "You're all set — confirmed",
        emailBody: `Hi ${f},\n\nThanks for booking some time with me — you're all set. I'm looking forward to it and will send a reminder beforehand. If anything comes up, just reply here.\n\nSee you then,\n${r}`,
        aiHint: "The lead booked a demo; this is a warm confirmation, not a sales pitch.",
        reachOut: true,
      };
    case "Not interested":
      return {
        sms: `Hi ${f}, no worries at all — really appreciate you taking my call. If the timing ever changes, I'm just one text away. Take care!`,
        emailSubject: "Appreciate your time",
        emailBody: `Hi ${f},\n\nThanks for being straight with me on the call — I completely understand. If anything changes down the road, I'm always happy to help. Wishing you the best.\n\nTake care,\n${r}`,
        aiHint: "The lead said not interested; be gracious and leave the door open, no pressure.",
        reachOut: true,
      };
    case "Bad / wrong number":
      // Nothing to send — there's no real person on the other end.
      return null;
    default:
      return null;
  }
};

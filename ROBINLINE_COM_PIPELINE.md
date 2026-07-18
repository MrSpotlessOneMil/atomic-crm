# robinline.com → Atomic CRM lead pipeline

Everything to paste into the **robinline.com repo** (`/Users/jack/Desktop/VS Code/robinline`)
so every lead captured on the main site flows into the CRM and gets the full
follow-up engine: instant opener text, playbook SMS/email cadence, and the
11-session double-dial call queue — with automatic stop-the-moment-they-reply.

The CRM side is already deployed and live. No secrets are needed in the
robinline repo: the public `web_lead` front door holds the real secret
server-side and forwards internally.

---

## 1. New file: `lib/marketing/crm-forward.ts`

```ts
// Forwards a captured marketing lead into the Atomic CRM (osiris-crm), which
// owns ALL automated follow-up: instant speed-to-lead text, the SMS/email
// nurture cadence, and the rep call queue. Fire-and-forget — never throws,
// never blocks the visitor-facing action. No secret needed: web_lead is the
// CRM's public front door (honeypot-guarded; it attaches the real secret
// server-side).

const CRM_WEB_LEAD_URL =
  "https://fliudmtgvnnqpnxpadwx.functions.supabase.co/functions/v1/web_lead";

export interface CrmLead {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  businessName?: string;
  /** Where on robinline.com this came from: "demo-chat" | "voice-demo" | "contact-form" | ... */
  sourceDetail: string;
  /** "es" for Spanish-language visitors -> the CRM runs the Spanish drip end-to-end. */
  language?: "en" | "es";
  /** utm_source/utm_medium/utm_campaign/utm_term/utm_content, fbclid, ttclid,
   *  gclid, referrer, landing_path — whatever you captured client-side. */
  attribution?: Record<string, string>;
}

export async function forwardLeadToCrm(lead: CrmLead): Promise<void> {
  if (!lead.email && !lead.phone) return; // nothing the CRM can work with
  try {
    await fetch(CRM_WEB_LEAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: lead.firstName,
        last_name: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        business_name: lead.businessName,
        // "robinline.com" in the source string is what the CRM's normalizer
        // keys on; keep it. sourceDetail is for humans reading the record.
        source: `robinline.com ${lead.sourceDetail}`,
        language: lead.language,
        attribution: lead.attribution,
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Never break the visitor flow over CRM sync. The CRM's enroll_orphans
    // sweep cannot catch leads that never reached it, so a persistent failure
    // here is worth an alert — but a one-off timeout is fine to swallow.
  }
}
```

## 2. Call it from every lead-capture server action

In `db/marketing/demo-lead-actions.ts` — inside **`submitDemoChatLead`** and
**`captureVoiceDemoContact`**, right after the successful insert into
`marketing_contact_submissions` (keep the existing `sendMarketingLeadAlert`
call — the founder text alert and the CRM forward are complementary):

```ts
import { forwardLeadToCrm } from "@/lib/marketing/crm-forward";

// ...after the existing insert + sendMarketingLeadAlert:
await forwardLeadToCrm({
  firstName,           // whatever your action already parsed
  lastName,
  email,
  phone,
  businessName,
  sourceDetail: "demo-chat",        // or "voice-demo"
  attribution: attributionMetadata, // the utm/fbclid/referrer object you already store
});
```

Same pattern in `db/marketing/contact-form-actions.ts` with
`sourceDetail: "contact-form"`.

Notes:
- `logDemoChatStart` (no contact info yet) should NOT forward — wait for the
  action that actually captures email/phone.
- Send phone in any format; the CRM normalizes to E.164.
- If the form knows the visitor is Spanish-speaking, pass `language: "es"` —
  the entire drip (texts + emails) runs in Spanish.

## 3. What the CRM does with each lead (so you know what to expect)

Within ~1 minute of the forward:
- Contact + deal created (deduped by phone/email — repeat submits never
  duplicate), `lead_source: website`, attribution stored.
- Opener text from (424) 677-1112: since there's no lead magnet, it's the
  honest "thanks for reaching out" opener, with the one-time opt-out line.
- Opener email from the closer's Gmail.
- A CALL NOW task appears on the rep dashboard (double-dial session 1 of 11).

Then the playbook cadence: texts at +3.5h, +8h, daily d2–d7, close-out d10,
9-word re-engagement d35, proof drop d90; emails at d3 (threaded) and d8; call
sessions through day 7. **Everything stops the instant the lead replies by
text, email, or has a real phone conversation** — or books, or texts STOP.

## 4. Test it before wiring the real actions

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"first_name":"Pipeline","last_name":"Test","phone":"+1YOURCELL","email":"you+test@robinline.com","source":"robinline.com pipeline-test","attribution":{"landing_path":"/manual-test"}}' \
  https://fliudmtgvnnqpnxpadwx.functions.supabase.co/functions/v1/web_lead
```

Expected: `{"ok":true,"contact_id":...,"deal_id":...,"enqueued":...}`, the
contact appears in osiris-crm.vercel.app within seconds, and your cell gets the
opener text within a minute (8am–8pm local; outside that window it holds until
morning). Reply to the text → all remaining automation cancels (check the
contact's timeline).

## 5. Heads-up on the un-merged branch

The branch `jack/demo-polish-and-lead-wizard` (commit f4c2ef0e) replaces the
deployed lead capture with a Google-Sheet wizard and, as written, removes every
caller of `sendMarketingLeadAlert` — shipping it as-is would kill the founder
SMS alert AND bypass this CRM forward. If/when that branch lands, add the same
`forwardLeadToCrm` call to the wizard's submit path.

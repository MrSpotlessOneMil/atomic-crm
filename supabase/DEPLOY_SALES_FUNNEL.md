# Deploy: Robin Line sales funnel

Additive to the osiris-crm SDR app. **ZERO changes to robinline-1.** New tables +
new edge functions + one widened notification check; existing tables/functions
untouched. Project ref: `fliudmtgvnnqpnxpadwx`.

## 0. Secrets
Function secrets — `npx supabase secrets set KEY=VALUE`:
- `DISPATCH_TASKS_TOKEN` = <random 32+ chars>     (cron auth for dispatch_tasks)
- `MANYCHAT_WEBHOOK_SECRET` = <random>            (ManyChat External Request header)
- `SALES_QUO_WEBHOOK_SECRET` = <OpenPhone webhook signing key for 1112>
- `CALENDLY_WEBHOOK_SIGNING_KEY` = <from Calendly webhook subscription>
- `SALES_AGENT_NAME` = Robin            (optional)
- `QUIET_HOURS_TZ` = America/New_York    (optional)

`integration_secrets` rows (SQL; service-role-only table):
- `SALES_AGENT_QUO_NUMBER` = `+14246771112`
- `CALENDLY_BOOKING_URL`   = https://calendly.com/dominic-theosirisai/cleaning-gameplan
- (`QUO_API_KEY`, `ANTHROPIC_API_KEY` already present.)

## 1. Schema (additive; no local Docker needed)
```
npx supabase db push     # applies 20260613190000_robinline_sales_funnel.sql
```

## 2. Edge functions
```
npx supabase functions deploy dispatch_tasks manychat_inbound quo_inbound sales_agent calendly_webhook
```

## 3. Crons + leak detector (remote SQL editor)
- `supabase/functions/dispatch_tasks/CRON_SETUP.sql`  (paste DISPATCH_TASKS_TOKEN)
- `supabase/cron/leak_detector.sql`

## 4. Webhooks — the phone-routing step (scope carefully; double-confirm w/ Dominic)
- **OpenPhone:** message webhook on the **1112 number ONLY** (resourceIds = that
  number's phoneNumberId — NEVER `"*"`) →
  `https://fliudmtgvnnqpnxpadwx.functions.supabase.co/functions/v1/quo_inbound`.
  Save its signing key as `SALES_QUO_WEBHOOK_SECRET`.
- **Calendly:** subscribe `invitee.created` + `invitee.canceled` →
  `.../functions/v1/calendly_webhook`. Signing key → `CALENDLY_WEBHOOK_SIGNING_KEY`.
- **ManyChat:** External Request (POST) on opt-in → `.../functions/v1/manychat_inbound`,
  header `X-MANYCHAT-SECRET: <MANYCHAT_WEBHOOK_SECRET>`,
  body `{ first_name, phone, email, platform, keyword, business_name }`.

## 5. Smoke tests (use a REAL cell — VoIP can't receive OpenPhone SMS)
- **Scheduler:** insert one `scheduled_tasks` `sms` row (see CRON_SETUP.sql) → text in ~1 min.
- **Agent:** `POST /sales_agent { "contact_id": N, "inbound": "both, I do houses" }`
  with header `X-DISPATCH-TOKEN` → agent replies + qualifies.
- **Inbound:** text **1112** from a real phone → reply arrives; confirm a text to a
  client number is IGNORED (scoping holds).
- **Booking:** book a test Calendly demo → deal goes `demo-booked`, reminders queued;
  cancel it → rebook nudge queued.
- **A2P 10DLC:** register before real volume (US automated-SMS deliverability + legal).
```

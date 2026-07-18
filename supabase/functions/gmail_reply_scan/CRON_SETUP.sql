-- ============================================================================
-- gmail_reply_scan — pg_cron setup  (RUN ONCE in the remote SQL editor)
-- ============================================================================
-- Detects lead replies to the automated email drip (they land in the closer's
-- Gmail inbox where no webhook can see them) and halts ALL automated follow-up
-- for that lead + notifies the rep. See index.ts.
--
-- Prerequisites, in order:
--   1. The stop_on_reply_foundations migration is pushed (npx supabase db push).
--   2. The gmail_reply_scan edge function is deployed.
--   3. DISPATCH_TASKS_TOKEN is set as a function secret (same one the
--      dispatcher uses — same pg_cron trust domain).
--   4. The closer's Gmail is connected (gmail_tokens row; CLOSER_SALES_ID in
--      integration_secrets picks whose inbox is scanned).
--
-- Replace <DISPATCH_TASKS_TOKEN> with the SAME value set as the function secret.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 5 minutes: a reply sits at most ~5 min before the drip stops and the
-- rep is pinged. (The send-time replied-guard in dispatch_tasks closes the
-- remaining race window.)
select cron.schedule(
  'gmail-reply-scan-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://fliudmtgvnnqpnxpadwx.supabase.co/functions/v1/gmail_reply_scan',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-DISPATCH-TOKEN', '<DISPATCH_TASKS_TOKEN>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect:  select jobname, schedule, active from cron.job;
-- Remove:   select cron.unschedule('gmail-reply-scan-every-5-min');

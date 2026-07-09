-- ============================================================================
-- enroll_orphans — pg_cron setup  (RUN ONCE in the remote SQL editor)
-- ============================================================================
-- Prerequisites, in order:
--   1. The call_cadence + contact_attribution migrations are applied.
--   2. The enroll_orphans edge function is deployed (plus dispatch_tasks,
--      lead_inbound and their _shared deps redeployed).
--   3. DISPATCH_TASKS_TOKEN function secret exists (same one dispatch uses).
--
-- The sweep enrolls at most 10 orphan leads per run and respects the shared
-- 60-tasks/hour flood cap, so the first backfill of old Meta leads drains
-- gradually over a few hours instead of blasting.
-- Replace <DISPATCH_TASKS_TOKEN> with the SAME value set as the function secret.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'enroll-orphans-every-10-min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://fliudmtgvnnqpnxpadwx.supabase.co/functions/v1/enroll_orphans',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-DISPATCH-TOKEN', '<DISPATCH_TASKS_TOKEN>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect:   select id, status, attempts, last_error from public.scheduled_tasks order by id desc limit 20;
-- One-off:   curl -X POST -H "X-DISPATCH-TOKEN: <token>" https://fliudmtgvnnqpnxpadwx.supabase.co/functions/v1/enroll_orphans
-- Remove:    select cron.unschedule('enroll-orphans-every-10-min');

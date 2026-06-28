-- ============================================================================
-- dispatch_tasks — pg_cron setup  (RUN ONCE in the remote SQL editor)
-- ============================================================================
-- Prerequisites, in order:
--   1. The scheduled_tasks migration is pushed (npx supabase db push).
--   2. The dispatch_tasks edge function is deployed.
--   3. Function secrets are set:
--        npx supabase secrets set DISPATCH_TASKS_TOKEN=<random-long-token>
--        npx supabase secrets set QUIET_HOURS_TZ=America/New_York   # optional
--   4. integration_secrets has SALES_AGENT_QUO_NUMBER (the dedicated sales line)
--      and QUO_API_KEY (already present).
--
-- pg_net is already used by this project (sync_contact_to_quo). pg_cron may need
-- enabling once in the dashboard (Database → Extensions) or via the line below.
-- Replace <DISPATCH_TASKS_TOKEN> with the SAME value set as the function secret.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Fire dispatch_tasks every minute. It self-throttles (BATCH=25/run) and is
-- idempotent (optimistic pending→processing claim), so overlap is safe.
select cron.schedule(
  'dispatch-tasks-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://fliudmtgvnnqpnxpadwx.supabase.co/functions/v1/dispatch_tasks',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-DISPATCH-TOKEN', '<DISPATCH_TASKS_TOKEN>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Smoke test (Phase 0): enqueue one SMS to a REAL cell (VoIP can't receive),
-- then watch it flip pending → sent within ~1 minute.
--   insert into public.scheduled_tasks (task_type, payload, run_at)
--   values ('sms', '{"to":"+1XXXXXXXXXX","content":"Robin Line dispatcher test ✅"}', now());
--
-- Inspect:   select id, status, attempts, last_error from public.scheduled_tasks order by id desc limit 5;
-- Remove:    select cron.unschedule('dispatch-tasks-every-minute');

-- ============================================================================
-- Leak detector  (RUN ONCE in the remote SQL editor)
-- ============================================================================
-- The structural guarantee behind "no one can slip through the cracks": every
-- active-stage deal must have either pending automation or a future next action.
-- This sweep finds any that don't, have gone quiet for 48h, and alerts admins
-- (notification type 'agent_handoff', payload.reason = 'stalled'). Runs hourly.
--
-- Future enhancement: instead of only alerting, auto-enqueue the right task
-- (re-open nurture, re-send a reminder) based on stage.
-- ============================================================================

create extension if not exists pg_cron;

create or replace function public.flag_stalled_deals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  flagged integer := 0;
begin
  with stalled as (
    select d.id as deal_id
    from public.deals d
    where d.stage in ('lead','contacted','demo-booked','proposal-sent','in-negociation')
      and d.sales_id is null   -- funnel (AI-owned) deals only; skip the human SDR pipeline
      and d.archived_at is null
      and d.updated_at < now() - interval '48 hours'
      and (d.next_action_date is null or d.next_action_date < current_date)
      and not exists (
        select 1 from public.scheduled_tasks t
        where t.deal_id = d.id and t.status = 'pending'
      )
      and not exists (
        select 1 from public.notifications n
        where n.type = 'agent_handoff'
          and (n.payload->>'deal_id')::bigint = d.id
          and (n.payload->>'reason') = 'stalled'
          and n.created_at > now() - interval '24 hours'
      )
  )
  insert into public.notifications (sales_id, type, payload)
  select s.id,
         'agent_handoff',
         jsonb_build_object(
           'deal_id', st.deal_id,
           'reason', 'stalled',
           'summary', 'Deal stalled: no pending automation and no next action in 48h.'
         )
  from stalled st
  cross join public.sales s
  where s.administrator and not s.disabled;

  get diagnostics flagged = row_count;
  return flagged;
end;
$$;

-- Hourly at minute 7 (offset from the dispatcher's every-minute run).
select cron.schedule(
  'flag-stalled-deals-hourly',
  '7 * * * *',
  $$ select public.flag_stalled_deals(); $$
);

-- Remove:  select cron.unschedule('flag-stalled-deals-hourly');
-- Manual:  select public.flag_stalled_deals();

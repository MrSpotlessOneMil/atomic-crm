-- Funnel activation: config rows + the leak-detector backstop.
-- Kept migration (no secrets). The every-minute dispatcher cron carries the
-- dispatch token, so it is scheduled once in the SQL editor (see
-- supabase/functions/dispatch_tasks/CRON_SETUP.sql) rather than committed here.

-- Sales number + Calendly link (edge functions read these from integration_secrets).
delete from integration_secrets where key in ('SALES_AGENT_QUO_NUMBER','CALENDLY_BOOKING_URL');
insert into integration_secrets (key, value) values
  ('SALES_AGENT_QUO_NUMBER', '+14246771112'),
  ('CALENDLY_BOOKING_URL', 'https://calendly.com/dominic-theosirisai/cleaning-gameplan');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Leak detector (funnel/AI-owned deals only) — the "no one slips" backstop.
create or replace function public.flag_stalled_deals()
returns integer language plpgsql security definer set search_path = public as $fn$
declare flagged integer := 0;
begin
  with stalled as (
    select d.id as deal_id
    from public.deals d
    where d.stage in ('lead','contacted','demo-booked','proposal-sent','in-negociation')
      and d.sales_id is null
      and d.archived_at is null
      and d.updated_at < now() - interval '48 hours'
      and (d.next_action_date is null or d.next_action_date < current_date)
      and not exists (select 1 from public.scheduled_tasks t where t.deal_id = d.id and t.status = 'pending')
      and not exists (
        select 1 from public.notifications n
        where n.type = 'agent_handoff' and (n.payload->>'deal_id')::bigint = d.id
          and (n.payload->>'reason') = 'stalled' and n.created_at > now() - interval '24 hours')
  )
  insert into public.notifications (sales_id, type, payload)
  select s.id, 'agent_handoff',
         jsonb_build_object('deal_id', st.deal_id, 'reason', 'stalled',
                            'summary', 'Funnel deal stalled: no pending automation and no next action in 48h.')
  from stalled st cross join public.sales s
  where s.administrator and not s.disabled;
  get diagnostics flagged = row_count;
  return flagged;
end;
$fn$;

select cron.schedule('flag-stalled-deals-hourly', '7 * * * *', $cron$ select public.flag_stalled_deals(); $cron$);

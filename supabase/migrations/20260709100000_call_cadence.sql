-- Human double-dial call cadence (voice-memo build, 2026-07-08).
--
-- scheduled_tasks gets a new task_type 'call_task' (free text - no constraint
-- change needed). When a step comes due, dispatch_tasks bridges it into the
-- human `tasks` table (type 'call') + a 'call_due' notification, so reps get a
-- CALL NOW queue on the dashboard.

-- 1) Widen the notification type check for the call-due alert.
--    (Drop + re-add is the only way to change a CHECK constraint.)
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment_on_post', 'lead_assigned', 'payout_approved', 'payout_paid', 'booking_created', 'agent_handoff', 'call_due'));

-- 2) Pool visibility for tasks: call tasks for UNASSIGNED leads are inserted
--    with sales_id null so any rep can claim them. Select/update previously
--    required ownership or admin; widen both to include the sales_id-null pool
--    (insert already allowed it).
drop policy if exists "Tasks select for owner or admin" on public.tasks;
create policy "Tasks select for owner or admin" on public.tasks
  for select to authenticated
  using (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
drop policy if exists "Tasks update for owner or admin" on public.tasks;
create policy "Tasks update for owner or admin" on public.tasks
  for update to authenticated
  using (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- 3) Fast lookup of the open call queue.
create index if not exists tasks_open_call_idx
  on public.tasks (due_date)
  where done_date is null and type = 'call';

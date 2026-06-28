-- Per-rep, per-day scorecard checklist state, so reps check items off and we
-- track daily progress over time.
create table if not exists public.daily_progress (
  sales_id bigint not null references public.sales(id) on delete cascade,
  date date not null,
  items jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sales_id, date)
);
alter table public.daily_progress enable row level security;

-- Reps see/edit their own day; admins (the owner) can see everyone's.
create policy "daily_progress select own or admin" on public.daily_progress
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "daily_progress insert own" on public.daily_progress
  for insert to authenticated
  with check (sales_id = (select id from public.sales where user_id = auth.uid()));
create policy "daily_progress update own" on public.daily_progress
  for update to authenticated
  using (sales_id = (select id from public.sales where user_id = auth.uid()))
  with check (sales_id = (select id from public.sales where user_id = auth.uid()));

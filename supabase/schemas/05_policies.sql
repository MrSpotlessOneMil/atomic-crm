--
-- Row Level Security
-- This file declares RLS policies for all tables.
--
-- Authorization model:
--   * Admins (public.is_admin() = true) have full access to all rows.
--   * Non-admin sales reps can only see and modify rows whose sales_id matches
--     their own sales row id (resolved via auth.uid()).
--   * The sales table itself remains readable to all authenticated users so the
--     leaderboard / reference inputs continue to work.
--   * Tags, configuration and favicons_excluded_domains remain shared.
--

-- Enable RLS on all tables
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_notes enable row level security;
alter table public.deals enable row level security;
alter table public.deal_notes enable row level security;
alter table public.sales enable row level security;
alter table public.tags enable row level security;
alter table public.tasks enable row level security;
alter table public.configuration enable row level security;
alter table public.favicons_excluded_domains enable row level security;
alter table public.deal_payouts enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.notifications enable row level security;

-- Companies
create policy "Companies select for owner or admin" on public.companies
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Companies insert for owner or admin" on public.companies
  for insert to authenticated
  with check (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Companies update for owner or admin" on public.companies
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Companies delete for owner or admin" on public.companies
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- Contacts
create policy "Contacts select for owner or admin" on public.contacts
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Contacts insert for owner or admin" on public.contacts
  for insert to authenticated
  with check (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Contacts update for owner or admin" on public.contacts
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Contacts delete for owner or admin" on public.contacts
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- Contact Notes
create policy "Contact notes select for owner or admin" on public.contact_notes
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Contact notes insert for owner or admin" on public.contact_notes
  for insert to authenticated
  with check (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Contact notes update for owner or admin" on public.contact_notes
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Contact notes delete for owner or admin" on public.contact_notes
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- Deals
create policy "Deals select for owner or admin" on public.deals
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Deals insert for owner or admin" on public.deals
  for insert to authenticated
  with check (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Deals update for owner or admin" on public.deals
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Deals delete for owner or admin" on public.deals
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- Deal Notes
create policy "Deal notes select for owner or admin" on public.deal_notes
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Deal notes insert for owner or admin" on public.deal_notes
  for insert to authenticated
  with check (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Deal notes update for owner or admin" on public.deal_notes
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Deal notes delete for owner or admin" on public.deal_notes
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- Tasks
create policy "Tasks select for owner or admin" on public.tasks
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Tasks insert for owner or admin" on public.tasks
  for insert to authenticated
  with check (
    public.is_admin()
    or sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Tasks update for owner or admin" on public.tasks
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Tasks delete for owner or admin" on public.tasks
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- Sales (readable to all so the leaderboard / reference inputs work)
create policy "Enable read access for authenticated users" on public.sales for select to authenticated using (true);

-- Tags
create policy "Enable read access for authenticated users" on public.tags for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.tags for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.tags for update to authenticated using (true);
create policy "Enable delete for authenticated users only" on public.tags for delete to authenticated using (true);

-- Configuration (admin-only for writes)
create policy "Enable read for authenticated" on public.configuration for select to authenticated using (true);
create policy "Enable insert for admins" on public.configuration for insert to authenticated with check (public.is_admin());
create policy "Enable update for admins" on public.configuration for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Favicons excluded domains
create policy "Enable access for authenticated users only" on public.favicons_excluded_domains to authenticated using (true) with check (true);

-- Deal payouts: reps see their own; admins manage everything
create policy "Payouts select for owner or admin" on public.deal_payouts
  for select to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Payouts insert for admins" on public.deal_payouts
  for insert to authenticated
  with check (public.is_admin());
create policy "Payouts update for admins" on public.deal_payouts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy "Payouts delete for admins" on public.deal_payouts
  for delete to authenticated
  using (public.is_admin());

-- Community: all authenticated reps can read everything; authors (or admins)
-- can edit/delete their own posts and comments.
create policy "Community posts read all" on public.community_posts
  for select to authenticated using (true);
create policy "Community posts insert as self" on public.community_posts
  for insert to authenticated
  with check (
    sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
    or public.is_admin()
  );
create policy "Community posts update author or admin" on public.community_posts
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Community posts delete author or admin" on public.community_posts
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

create policy "Community comments read all" on public.community_comments
  for select to authenticated using (true);
create policy "Community comments insert as self" on public.community_comments
  for insert to authenticated
  with check (
    sales_id is null
    or sales_id = (select id from public.sales where user_id = auth.uid())
    or public.is_admin()
  );
create policy "Community comments update author or admin" on public.community_comments
  for update to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );
create policy "Community comments delete author or admin" on public.community_comments
  for delete to authenticated
  using (
    public.is_admin()
    or sales_id = (select id from public.sales where user_id = auth.uid())
  );

-- Notifications: each rep sees only their own; updates (mark as read) limited
-- to author. Inserts only via SECURITY DEFINER triggers, so blocked from the
-- client. Deletes also limited to the rep (cleanup).
create policy "Notifications select self" on public.notifications
  for select to authenticated
  using (sales_id = (select id from public.sales where user_id = auth.uid()));
create policy "Notifications update self" on public.notifications
  for update to authenticated
  using (sales_id = (select id from public.sales where user_id = auth.uid()))
  with check (sales_id = (select id from public.sales where user_id = auth.uid()));
create policy "Notifications delete self" on public.notifications
  for delete to authenticated
  using (sales_id = (select id from public.sales where user_id = auth.uid()));

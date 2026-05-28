-- Tighten RLS for self-signup
--
-- Replaces the wide-open `using (true)` policies on companies, contacts,
-- contact_notes, deals, deal_notes and tasks with policies that scope access
-- to the row owner (sales_id matches the calling user's sales row) while
-- preserving full access for administrators.
--
-- This migration was hand-written (Docker / Supabase CLI was not running on the
-- development machine when the schema was changed).

set check_function_bodies = off;

-- Companies
drop policy if exists "Enable read access for authenticated users" on public.companies;
drop policy if exists "Enable insert for authenticated users only" on public.companies;
drop policy if exists "Enable update for authenticated users only" on public.companies;
drop policy if exists "Company Delete Policy" on public.companies;

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
drop policy if exists "Enable read access for authenticated users" on public.contacts;
drop policy if exists "Enable insert for authenticated users only" on public.contacts;
drop policy if exists "Enable update for authenticated users only" on public.contacts;
drop policy if exists "Contact Delete Policy" on public.contacts;

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

-- Contact notes
drop policy if exists "Enable read access for authenticated users" on public.contact_notes;
drop policy if exists "Enable insert for authenticated users only" on public.contact_notes;
drop policy if exists "Contact Notes Update policy" on public.contact_notes;
drop policy if exists "Contact Notes Delete Policy" on public.contact_notes;

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
drop policy if exists "Enable read access for authenticated users" on public.deals;
drop policy if exists "Enable insert for authenticated users only" on public.deals;
drop policy if exists "Enable update for authenticated users only" on public.deals;
drop policy if exists "Deals Delete Policy" on public.deals;

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

-- Deal notes
drop policy if exists "Enable read access for authenticated users" on public.deal_notes;
drop policy if exists "Enable insert for authenticated users only" on public.deal_notes;
drop policy if exists "Deal Notes Update Policy" on public.deal_notes;
drop policy if exists "Deal Notes Delete Policy" on public.deal_notes;

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
drop policy if exists "Enable read access for authenticated users" on public.tasks;
drop policy if exists "Enable insert for authenticated users only" on public.tasks;
drop policy if exists "Task Update Policy" on public.tasks;
drop policy if exists "Task Delete Policy" on public.tasks;

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

-- Shared lead pool: every rep sees ALL companies + contacts and filters by
-- region. (Deals/payouts stay per-rep so the pipeline + leaderboard are
-- attributed correctly.)

-- Companies: all authenticated reps can see and work any company.
drop policy if exists "Companies select for owner or admin" on public.companies;
create policy "Companies select all authenticated" on public.companies
  for select to authenticated using (true);

drop policy if exists "Companies update for owner or admin" on public.companies;
create policy "Companies update all authenticated" on public.companies
  for update to authenticated using (true) with check (true);

-- Contacts: visible to the whole team (so contacts on shared companies show).
drop policy if exists "Contacts select for owner or admin" on public.contacts;
create policy "Contacts select all authenticated" on public.contacts
  for select to authenticated using (true);

-- Contact notes: visible to the team (shared lead history / conversations).
drop policy if exists "Contact notes select for owner or admin" on public.contact_notes;
create policy "Contact notes select all authenticated" on public.contact_notes
  for select to authenticated using (true);

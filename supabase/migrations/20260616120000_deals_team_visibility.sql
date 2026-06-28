-- Team-wide pipeline visibility.
--
-- Until now `deals` + `deal_notes` were "owner or admin": a non-admin rep could
-- only SELECT rows whose sales_id matched their own. That made the /deals Kanban
-- pipeline look empty for SDRs and made the leaderboard show only their own row
-- (it reads won deals across the team). Companies + contacts were already opened
-- to a shared pool in 20260602140000_shared_lead_pool.sql; this brings deals in
-- line for *reads only*.
--
-- Writes stay owner-or-admin (insert/update/delete policies are untouched), so a
-- rep can see the whole team's pipeline but can still only modify deals assigned
-- to them. Leaderboard attribution (deals.sales_id) is therefore preserved.

-- Deals: visible to the whole team.
drop policy if exists "Deals select for owner or admin" on public.deals;
create policy "Deals select all authenticated" on public.deals
  for select to authenticated using (true);

-- Deal notes: visible to the whole team (so the pipeline history reads).
drop policy if exists "Deal notes select for owner or admin" on public.deal_notes;
create policy "Deal notes select all authenticated" on public.deal_notes
  for select to authenticated using (true);

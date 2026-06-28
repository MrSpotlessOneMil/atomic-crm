-- Robin Line SDR fields, matching the team's real pipeline tracker.
-- All additive (add column if not exists) so it is safe on the live DB.

-- Deal-level qualifier + follow-up tracking (read directly from public.deals,
-- no summary view to update).
alter table public.deals
  add column if not exists pain_point text,
  add column if not exists next_action text,
  add column if not exists next_action_date date,
  add column if not exists owner_type text,
  add column if not exists follow_up_count integer not null default 0;

-- Rep identity: which social platform + cold-call territory they own, and
-- whether they are an SDR or an Account Executive (upgrade path).
alter table public.sales
  add column if not exists platform text,
  add column if not exists territory text,
  add column if not exists sdr_role text not null default 'sdr';

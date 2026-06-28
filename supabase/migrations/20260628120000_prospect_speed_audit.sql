-- Prospect speed-to-lead audit fields.
-- The SDR (or a helper) places ONE genuine shopper inquiry to a prospect
-- cleaning company (a real "what's your price for X" ask) and records how slow
-- they were to respond. That measured gap becomes honest proof in the outreach
-- back to them: "i asked you for a quote 6 days ago and never heard back - robin
-- line answers every lead in 15 seconds." All real, no fabricated jobs.
--
-- ADDITIVE ONLY (add column if not exists) so it is safe on the live DB, same as
-- the SDR fields in 20260601120000_sdr_fields.sql.

alter table public.deals
  -- when we sent the genuine inquiry, and through which channel we asked
  add column if not exists audit_inquiry_sent_at timestamp with time zone,
  add column if not exists audit_channel text,            -- 'sms' | 'email' | 'web_form' | 'phone'
  -- what we genuinely asked about (a real service they offer), e.g. 'move-out',
  -- 'post-construction', 'recurring-office'. Keeps the inquiry truthful + on-brand.
  add column if not exists audit_job_type text,
  -- when (if ever) they replied; null + enough elapsed time = they never answered
  add column if not exists audit_first_reply_at timestamp with time zone,
  -- did they ever chase the job after that first reply, or go quiet
  add column if not exists audit_followed_up boolean,
  add column if not exists audit_notes text;

comment on column public.deals.audit_inquiry_sent_at is
  'When a genuine shopper inquiry was sent to this prospect (speed-to-lead audit baseline).';
comment on column public.deals.audit_first_reply_at is
  'When the prospect first replied to the audit inquiry; null means no reply yet.';

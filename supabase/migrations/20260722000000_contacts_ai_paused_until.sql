-- Per-contact automation pause: when a human texts a lead from the OpenPhone
-- app, that one conversation becomes human-owned and the AI stops.
--
-- A deadline rather than a boolean so a forgotten pause self-heals instead of
-- silently muting that lead forever. NULL = not paused.
-- See supabase/functions/_shared/aiPause.ts.

alter table public.contacts
  add column if not exists ai_paused_until timestamptz;

comment on column public.contacts.ai_paused_until is
  'When set and in the future, a human owns this conversation: the AI sales agent will not reply and chase tasks defer. Set by quo_inbound on human outbound SMS; cleared to hand the lead back to the AI.';

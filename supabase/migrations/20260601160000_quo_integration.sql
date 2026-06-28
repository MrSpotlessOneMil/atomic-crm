-- Robin Line: Quo (OpenPhone) texting integration.

-- Server-only secrets store. RLS enabled with NO policies => no client (anon or
-- authenticated) can read it; only the service role (edge functions) bypasses RLS.
create table if not exists public.integration_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;

-- Each rep's own Quo phone number (E.164, e.g. +13105551234) — the "from".
alter table public.sales
  add column if not exists quo_phone text;

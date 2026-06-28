-- Robin Line: Gmail (Google Workspace) send-as-rep integration.

-- Per-rep OAuth refresh tokens. RLS on with NO policies => only the service
-- role (edge functions) can read these. Refresh tokens are sensitive and must
-- never be client-readable (the sales table is, so they can't live there).
create table if not exists public.gmail_tokens (
  sales_id bigint primary key references public.sales(id) on delete cascade,
  email text,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.gmail_tokens enable row level security;

-- Client-readable flag so the UI can show "Gmail connected" without exposing
-- the token. Set true by the OAuth callback.
alter table public.sales
  add column if not exists gmail_connected boolean not null default false;

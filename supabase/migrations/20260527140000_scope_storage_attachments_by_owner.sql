-- Scope storage.objects attachments policies to the owner (or admin)
--
-- Attachments are now uploaded under the path `<sales_id>/<random>.<ext>` so
-- the first path segment identifies the owner. Policies check that segment
-- against the calling user's sales row. Admins bypass the path check.
--
-- The previous policies allowed any authenticated user to read/insert/delete
-- any object in the attachments bucket, which lets one rep enumerate and
-- download another rep's attachments by guessing or scraping paths.
--
-- Existing files uploaded BEFORE this migration live at the bucket root with
-- no `<sales_id>` prefix. They will become inaccessible via the user-facing
-- API after this migration. Admins can still see and migrate them. Use the
-- service role to backfill: prefix each legacy file path with the relevant
-- owner's sales_id before exposing it again.

set check_function_bodies = off;

drop policy if exists "Attachments 1mt4rzk_0" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_1" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_3" on storage.objects;

create policy "Attachments select for owner or admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = (
        select id::text from public.sales where user_id = auth.uid()
      )
    )
  );

create policy "Attachments insert for owner or admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = (
        select id::text from public.sales where user_id = auth.uid()
      )
    )
  );

create policy "Attachments update for owner or admin" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = (
        select id::text from public.sales where user_id = auth.uid()
      )
    )
  )
  with check (
    bucket_id = 'attachments'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = (
        select id::text from public.sales where user_id = auth.uid()
      )
    )
  );

create policy "Attachments delete for owner or admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = (
        select id::text from public.sales where user_id = auth.uid()
      )
    )
  );

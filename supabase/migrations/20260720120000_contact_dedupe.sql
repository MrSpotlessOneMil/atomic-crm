-- Phone-keyed contact de-duplication: one source of truth per phone number.
--
-- Three parts:
--   1. primary_phone — a normalized (E.164) dedup key on contacts, maintained
--      by the phone trigger and indexed. This is what "same person" means.
--   2. merge_two_contacts(winner, loser) — a LOSSLESS merge: it reassigns EVERY
--      table that references contacts (6 of them cascade-delete, so failing to
--      reassign would destroy the loser's messages/tasks/calls) before deleting
--      the loser, and unions the winner's arrays + fills its null scalars.
--   3. dedupe_contacts_by_phone(max) — finds every cluster of contacts sharing a
--      primary_phone and merges the losers into the best record. Used by the
--      pg_cron sweeper and for the one-time cleanup of existing duplicates.

-- 1. primary_phone dedup key -------------------------------------------------
alter table public.contacts add column if not exists primary_phone text;

-- Extend the normalize trigger to also stamp primary_phone (first stored number,
-- E.164) on every insert/update.
CREATE OR REPLACE FUNCTION "public"."normalize_contact_phones"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  first_num text;
begin
    if new.phone_jsonb is not null and jsonb_typeof(new.phone_jsonb) = 'array' then
        select coalesce(jsonb_agg(
            case
                when jsonb_typeof(elem) = 'object' and (elem->>'number') is not null
                    then jsonb_set(elem, '{number}', to_jsonb(public.phone_to_e164(elem->>'number')))
                when jsonb_typeof(elem) = 'string' and btrim(elem #>> '{}') <> ''
                    then to_jsonb(public.phone_to_e164(elem #>> '{}'))
                else elem
            end
            order by ord
        ), '[]'::jsonb)
        into new.phone_jsonb
        from jsonb_array_elements(new.phone_jsonb) with ordinality as t(elem, ord);
    end if;
    select case when jsonb_typeof(e) = 'object' then e->>'number' else e #>> '{}' end
        into first_num
    from jsonb_array_elements(coalesce(new.phone_jsonb, '[]'::jsonb)) e
    limit 1;
    new.primary_phone := nullif(public.phone_to_e164(first_num), '');
    return new;
end;
$$;

-- Backfill primary_phone for existing rows. User triggers OFF so the bulk
-- update doesn't fire the per-row avatar-fetch trigger.
alter table public.contacts disable trigger user;
update public.contacts
set primary_phone = nullif(public.phone_to_e164(
    (select case when jsonb_typeof(e) = 'object' then e->>'number' else e #>> '{}' end
     from jsonb_array_elements(coalesce(phone_jsonb, '[]'::jsonb)) e
     limit 1)
), '')
where primary_phone is null;
alter table public.contacts enable trigger user;

create index if not exists contacts_primary_phone_idx
    on public.contacts (primary_phone)
    where primary_phone is not null;

-- 2. Lossless pairwise merge -------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."merge_two_contacts"("p_winner" bigint, "p_loser" bigint)
    RETURNS void
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  w public.contacts;
  l public.contacts;
begin
    if p_winner = p_loser then return; end if;
    select * into w from public.contacts where id = p_winner;
    select * into l from public.contacts where id = p_loser;
    if w.id is null or l.id is null then return; end if;

    -- Reassign every child table loser -> winner. The six cascade-delete FKs
    -- (agent_messages, call_logs, contact_notes, scheduled_tasks, sms_messages,
    -- tasks) MUST move first or the loser delete would take them with it; the
    -- three set-null FKs (bookings, sms/email_suppressions) move too so the link
    -- survives.
    update public.tasks set contact_id = p_winner where contact_id = p_loser;
    update public.contact_notes set contact_id = p_winner where contact_id = p_loser;
    update public.agent_messages set contact_id = p_winner where contact_id = p_loser;
    update public.sms_messages set contact_id = p_winner where contact_id = p_loser;
    update public.call_logs set contact_id = p_winner where contact_id = p_loser;
    update public.scheduled_tasks set contact_id = p_winner where contact_id = p_loser;
    update public.bookings set contact_id = p_winner where contact_id = p_loser;
    update public.sms_suppressions set contact_id = p_winner where contact_id = p_loser;
    update public.email_suppressions set contact_id = p_winner where contact_id = p_loser;

    -- deals.contact_ids is a bigint[] (not an FK): swap loser -> winner, dedup.
    update public.deals
    set contact_ids = (
        select array_agg(distinct e)
        from unnest(array_replace(contact_ids, p_loser, p_winner)) e
    )
    where contact_ids @> array[p_loser]::bigint[];

    -- Merge winner: winner scalars win, loser fills nulls; arrays union.
    update public.contacts set
        first_name = coalesce(w.first_name, l.first_name),
        last_name = coalesce(w.last_name, l.last_name),
        gender = coalesce(w.gender, l.gender),
        title = coalesce(w.title, l.title),
        background = coalesce(w.background, l.background),
        avatar = case when (w.avatar->>'src') is not null then w.avatar else l.avatar end,
        has_newsletter = coalesce(w.has_newsletter, l.has_newsletter),
        status = coalesce(w.status, l.status),
        company_id = coalesce(w.company_id, l.company_id),
        sales_id = coalesce(w.sales_id, l.sales_id),
        linkedin_url = coalesce(nullif(w.linkedin_url, ''), l.linkedin_url),
        lead_source = coalesce(w.lead_source, l.lead_source),
        attribution = case
            when w.attribution is null or w.attribution = '{}'::jsonb then l.attribution
            else w.attribution end,
        first_seen = least(w.first_seen, l.first_seen),
        last_seen = greatest(w.last_seen, l.last_seen),
        tags = (
            select coalesce(array_agg(distinct t), '{}')
            from unnest(coalesce(w.tags, '{}') || coalesce(l.tags, '{}')) t
        ),
        email_jsonb = (
            select coalesce(jsonb_agg(elem), '[]'::jsonb) from (
                select distinct on (elem->>'email') elem
                from jsonb_array_elements(
                    coalesce(w.email_jsonb, '[]'::jsonb) || coalesce(l.email_jsonb, '[]'::jsonb)
                ) elem
                order by elem->>'email'
            ) s
        ),
        phone_jsonb = (
            select coalesce(jsonb_agg(elem), '[]'::jsonb) from (
                select distinct on (elem->>'number') elem
                from jsonb_array_elements(
                    coalesce(w.phone_jsonb, '[]'::jsonb) || coalesce(l.phone_jsonb, '[]'::jsonb)
                ) elem
                order by elem->>'number'
            ) s
        )
    where id = p_winner;

    delete from public.contacts where id = p_loser;
end;
$$;

-- 3. Phone-keyed dedup sweep -------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."dedupe_contacts_by_phone"("p_max" integer DEFAULT 200)
    RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  c_phone text;
  c_winner bigint;
  c_loser bigint;
  clusters int := 0;
  merged int := 0;
begin
    for c_phone in
        select primary_phone
        from public.contacts
        where primary_phone is not null and primary_phone <> ''
        group by primary_phone
        having count(*) > 1
        limit p_max
    loop
        clusters := clusters + 1;
        -- Winner = the most "real" record: has a deal, else most recently seen,
        -- else newest id. All other rows' data is preserved via the merge.
        select cc.id into c_winner
        from public.contacts cc
        where cc.primary_phone = c_phone
        order by
            (exists (select 1 from public.deals d where d.contact_ids @> array[cc.id]::bigint[])) desc,
            cc.last_seen desc nulls last,
            cc.id desc
        limit 1;

        for c_loser in
            select id from public.contacts
            where primary_phone = c_phone and id <> c_winner
        loop
            perform public.merge_two_contacts(c_winner, c_loser);
            merged := merged + 1;
        end loop;
    end loop;

    return jsonb_build_object('clusters', clusters, 'merged', merged);
end;
$$;

revoke all on function public.merge_two_contacts(bigint, bigint) from public, anon, authenticated;
revoke all on function public.dedupe_contacts_by_phone(integer) from public, anon, authenticated;

-- Sweeper cron (RUN ONCE in the remote SQL editor; pg_cron already enabled):
--   select cron.schedule(
--     'dedupe-contacts-every-15-min', '*/15 * * * *',
--     $$select public.dedupe_contacts_by_phone(200);$$
--   );
-- Remove:  select cron.unschedule('dedupe-contacts-every-15-min');
-- One-time cleanup of pre-existing duplicates: select public.dedupe_contacts_by_phone(500);

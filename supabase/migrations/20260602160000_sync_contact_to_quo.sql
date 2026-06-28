-- Mirror new CRM contacts into OpenPhone (so names show on calls/texts).
-- Fires asynchronously via pg_net and never blocks the insert.
create extension if not exists pg_net;

create or replace function public.sync_contact_to_quo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text;
  v_phone text;
  v_email text;
begin
  begin
    select name into v_company from public.companies where id = new.company_id;
    v_phone := new.phone_jsonb -> 0 ->> 'number';
    v_email := new.email_jsonb -> 0 ->> 'email';
    perform net.http_post(
      url := 'https://fliudmtgvnnqpnxpadwx.supabase.co/functions/v1/quo_create_contact',
      body := jsonb_build_object(
        'contact_id', new.id,
        'first_name', new.first_name,
        'last_name', new.last_name,
        'phone', v_phone,
        'email', v_email,
        'company', v_company,
        'external_id', new.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_575nEyXP3wgvhF6BpwbD2w_reIvLRTL'
      )
    );
  exception when others then
    -- Never block contact creation if the sync call fails.
    null;
  end;
  return new;
end;
$$;

create or replace trigger sync_contact_to_quo_trigger
  after insert on public.contacts
  for each row execute function public.sync_contact_to_quo();

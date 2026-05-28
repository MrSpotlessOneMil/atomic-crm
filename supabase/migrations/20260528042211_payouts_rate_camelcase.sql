set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_deal_won_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rate numeric(5,4);
  amount_cents bigint;
begin
  -- Only act when the deal just transitioned into stage 'won'.
  if NEW.stage is distinct from 'won' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and OLD.stage = 'won' then
    -- Already won previously; do nothing.
    return NEW;
  end if;

  -- No rep on the deal — skip silently.
  if NEW.sales_id is null then
    return NEW;
  end if;

  -- Resolve commission rate from configuration.config.payouts.defaultRate,
  -- defaulting to 10%.
  select coalesce(
    nullif(((c.config -> 'payouts' ->> 'defaultRate'))::numeric, 0),
    0.10
  ) into rate
  from public.configuration c
  where c.id = 1;
  if rate is null then
    rate := 0.10;
  end if;

  amount_cents := round(coalesce(NEW.amount, 0) * rate * 100);

  -- Create the payout row. Unique index on deal_id (where status != 'void')
  -- protects against double-creates on rapid re-saves.
  insert into public.deal_payouts (deal_id, sales_id, amount_cents, commission_rate, status)
  values (NEW.id, NEW.sales_id, amount_cents, rate, 'pending')
  on conflict do nothing;

  return NEW;
end;
$function$
;



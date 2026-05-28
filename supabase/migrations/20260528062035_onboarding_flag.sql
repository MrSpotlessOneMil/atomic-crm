alter table "public"."sales" add column "onboarding_completed_at" timestamp with time zone;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.mark_onboarding_completed()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.sales
  set onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where user_id = auth.uid();
end;
$function$
;



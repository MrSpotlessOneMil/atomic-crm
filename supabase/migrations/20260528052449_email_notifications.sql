set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_edge_function_url(function_name text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
    DECLARE
      issuer text;
      function_url text;
    BEGIN
      issuer := coalesce(
        nullif(current_setting('request.jwt.claim.iss', true), ''),
        (
          coalesce(
            nullif(current_setting('request.jwt.claims', true), ''),
            '{}'
          )::jsonb ->> 'iss'
        )
      );
      issuer := nullif(issuer, '');
      IF issuer IS NOT NULL THEN
        issuer := rtrim(issuer, '/');
        IF right(issuer, 8) = '/auth/v1' THEN
          function_url :=
            left(issuer, length(issuer) - 8) || '/functions/v1/' || function_name;

          IF function_url LIKE 'http://127.0.0.1:%' THEN
            RETURN replace(
              function_url,
              'http://127.0.0.1:',
              'http://host.docker.internal:'
            );
          END IF;

          IF function_url LIKE 'http://localhost:%' THEN
            RETURN replace(
              function_url,
              'http://localhost:',
              'http://host.docker.internal:'
            );
          END IF;

          RETURN function_url;
        END IF;
      END IF;

      RETURN 'http://host.docker.internal:54321/functions/v1/' || function_name;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.send_notification_email(notif_id bigint, sales_id bigint, notif_type text, payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      auth_header text;
      request_headers jsonb;
      body jsonb;
    BEGIN
      request_headers := coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
      auth_header := request_headers ->> 'authorization';

      -- No auth header means we're running outside an API request (e.g. SQL
      -- console, a cascading trigger, a CLI). Skip the call — the in-app
      -- notification is still written, and emails for server-side events can
      -- be sent later via a separate worker / cron job.
      IF auth_header IS NULL OR auth_header = '' THEN
        RETURN;
      END IF;

      body := jsonb_build_object(
        'notification_id', notif_id,
        'sales_id', sales_id,
        'type', notif_type,
        'payload', payload
      );

      PERFORM net.http_post(
        url := public.get_edge_function_url('send_email'),
        body := body,
        params := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',
          'application/json',
          'Authorization',
          auth_header
        ),
        timeout_milliseconds := 10000
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let a failed email kill the user-facing write.
      RAISE WARNING 'send_notification_email failed: %', SQLERRM;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.notify_on_community_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  post_author_id bigint;
  post_title text;
  notif_id bigint;
  notif_payload jsonb;
begin
  select sales_id, title into post_author_id, post_title
  from public.community_posts where id = NEW.post_id;

  if post_author_id is null or post_author_id = NEW.sales_id then
    return NEW;
  end if;

  notif_payload := jsonb_build_object(
    'post_id', NEW.post_id,
    'post_title', coalesce(post_title, ''),
    'comment_id', NEW.id,
    'commenter_sales_id', NEW.sales_id
  );

  insert into public.notifications (sales_id, type, payload)
  values (post_author_id, 'comment_on_post', notif_payload)
  returning id into notif_id;

  perform public.send_notification_email(notif_id, post_author_id, 'comment_on_post', notif_payload);
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_lead_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  notif_id bigint;
  notif_payload jsonb;
begin
  if NEW.sales_id is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.sales_id is not distinct from NEW.sales_id then
    return NEW;
  end if;

  notif_payload := jsonb_build_object(
    'contact_id', NEW.id,
    'first_name', NEW.first_name,
    'last_name', NEW.last_name
  );

  insert into public.notifications (sales_id, type, payload)
  values (NEW.sales_id, 'lead_assigned', notif_payload)
  returning id into notif_id;

  perform public.send_notification_email(notif_id, NEW.sales_id, 'lead_assigned', notif_payload);
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_payout_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  notif_type text;
  notif_id bigint;
  notif_payload jsonb;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  if NEW.status = 'approved' then
    notif_type := 'payout_approved';
  elsif NEW.status = 'paid' then
    notif_type := 'payout_paid';
  else
    return NEW;
  end if;

  notif_payload := jsonb_build_object(
    'payout_id', NEW.id,
    'deal_id', NEW.deal_id,
    'amount_cents', NEW.amount_cents
  );

  insert into public.notifications (sales_id, type, payload)
  values (NEW.sales_id, notif_type, notif_payload)
  returning id into notif_id;

  perform public.send_notification_email(notif_id, NEW.sales_id, notif_type, notif_payload);
  return NEW;
end;
$function$
;



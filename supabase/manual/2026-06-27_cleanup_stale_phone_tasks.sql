-- 2026-06-27 — Fix 3: cancel stale "no phone" failed tasks.
--
-- Background: 11 reminder_sms / no_show_check tasks are stuck status='failed'
-- with last_error like 'no phone%'. They belong to 3 phoneless contacts booked
-- via Calendly (Pete Sok #46, Max #52, Mike Harkey #50). Every run_at is in the
-- past (Jun 17-19), so the demos are over and nothing should be sent.
--
-- Going forward this can't recur: calendly_webhook no longer enqueues SMS
-- reminders for phoneless contacts, and dispatch_tasks now CANCELS (not fails)
-- any no-phone task that slips through.
--
-- REVIEW FIRST, then run against the sales DB (project fliudmtgvnnqpnxpadwx).
-- Safe + idempotent: only touches already-failed no-phone rows.

-- Preview what will change:
-- select id, task_type, contact_id, run_at, last_error
-- from public.scheduled_tasks
-- where status = 'failed' and last_error ilike '%phone%'
-- order by run_at desc;

update public.scheduled_tasks
set status     = 'canceled',
    last_error = 'no phone (cleaned up 2026-06-27)',
    updated_at = now()
where status = 'failed'
  and last_error ilike '%phone%';

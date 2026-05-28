--
-- Grants
-- This file declares all grants and default privileges for the public schema.
--

-- Schema usage
grant usage on schema public to postgres;
grant usage on schema public to anon;
grant usage on schema public to authenticated;
grant usage on schema public to service_role;

-- Function grants
grant all on function public.cleanup_note_attachments() to anon;
grant all on function public.cleanup_note_attachments() to authenticated;
grant all on function public.cleanup_note_attachments() to service_role;

grant all on function public.get_avatar_for_email(text) to anon;
grant all on function public.get_avatar_for_email(text) to authenticated;
grant all on function public.get_avatar_for_email(text) to service_role;

grant all on function public.get_domain_favicon(text) to anon;
grant all on function public.get_domain_favicon(text) to authenticated;
grant all on function public.get_domain_favicon(text) to service_role;

grant all on function public.get_note_attachments_function_url() to anon;
grant all on function public.get_note_attachments_function_url() to authenticated;
grant all on function public.get_note_attachments_function_url() to service_role;

revoke all on function public.get_user_id_by_email(text) from public;
grant all on function public.get_user_id_by_email(text) to service_role;

grant all on function public.handle_company_saved() to anon;
grant all on function public.handle_company_saved() to authenticated;
grant all on function public.handle_company_saved() to service_role;

grant all on function public.handle_contact_note_created_or_updated() to anon;
grant all on function public.handle_contact_note_created_or_updated() to authenticated;
grant all on function public.handle_contact_note_created_or_updated() to service_role;

grant all on function public.handle_contact_saved() to anon;
grant all on function public.handle_contact_saved() to authenticated;
grant all on function public.handle_contact_saved() to service_role;

grant all on function public.handle_new_user() to anon;
grant all on function public.handle_new_user() to authenticated;
grant all on function public.handle_new_user() to service_role;

grant all on function public.handle_update_user() to anon;
grant all on function public.handle_update_user() to authenticated;
grant all on function public.handle_update_user() to service_role;

grant all on function public.is_admin() to anon;
grant all on function public.is_admin() to authenticated;
grant all on function public.is_admin() to service_role;

grant all on function public.lowercase_email_jsonb() to anon;
grant all on function public.lowercase_email_jsonb() to authenticated;
grant all on function public.lowercase_email_jsonb() to service_role;

grant all on function public.merge_contacts(bigint, bigint) to anon;
grant all on function public.merge_contacts(bigint, bigint) to authenticated;
grant all on function public.merge_contacts(bigint, bigint) to service_role;

grant all on function public.set_sales_id_default() to anon;
grant all on function public.set_sales_id_default() to authenticated;
grant all on function public.set_sales_id_default() to service_role;

grant all on function public.mark_onboarding_completed() to anon;
grant all on function public.mark_onboarding_completed() to authenticated;
grant all on function public.mark_onboarding_completed() to service_role;

grant all on function public.handle_deal_won_payout() to anon;
grant all on function public.handle_deal_won_payout() to authenticated;
grant all on function public.handle_deal_won_payout() to service_role;

grant all on function public.notify_on_community_comment() to anon;
grant all on function public.notify_on_community_comment() to authenticated;
grant all on function public.notify_on_community_comment() to service_role;

grant all on function public.notify_on_lead_assignment() to anon;
grant all on function public.notify_on_lead_assignment() to authenticated;
grant all on function public.notify_on_lead_assignment() to service_role;

grant all on function public.notify_on_payout_status() to anon;
grant all on function public.notify_on_payout_status() to authenticated;
grant all on function public.notify_on_payout_status() to service_role;

grant all on function public.notify_on_booking_created() to anon;
grant all on function public.notify_on_booking_created() to authenticated;
grant all on function public.notify_on_booking_created() to service_role;

grant all on function public.get_edge_function_url(text) to anon;
grant all on function public.get_edge_function_url(text) to authenticated;
grant all on function public.get_edge_function_url(text) to service_role;

grant all on function public.send_notification_email(bigint, bigint, text, jsonb) to anon;
grant all on function public.send_notification_email(bigint, bigint, text, jsonb) to authenticated;
grant all on function public.send_notification_email(bigint, bigint, text, jsonb) to service_role;

-- Table grants
grant all on table public.companies to anon;
grant all on table public.companies to authenticated;
grant all on table public.companies to service_role;

grant all on table public.contacts to anon;
grant all on table public.contacts to authenticated;
grant all on table public.contacts to service_role;

grant all on table public.contact_notes to anon;
grant all on table public.contact_notes to authenticated;
grant all on table public.contact_notes to service_role;

grant all on table public.deals to anon;
grant all on table public.deals to authenticated;
grant all on table public.deals to service_role;

grant all on table public.deal_notes to anon;
grant all on table public.deal_notes to authenticated;
grant all on table public.deal_notes to service_role;

grant all on table public.sales to anon;
grant all on table public.sales to authenticated;
grant all on table public.sales to service_role;

grant all on table public.tags to anon;
grant all on table public.tags to authenticated;
grant all on table public.tags to service_role;

grant all on table public.tasks to anon;
grant all on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

grant all on table public.configuration to anon;
grant all on table public.configuration to authenticated;
grant all on table public.configuration to service_role;

grant all on table public.favicons_excluded_domains to anon;
grant all on table public.favicons_excluded_domains to authenticated;
grant all on table public.favicons_excluded_domains to service_role;

grant all on table public.deal_payouts to anon;
grant all on table public.deal_payouts to authenticated;
grant all on table public.deal_payouts to service_role;

grant all on table public.community_posts to anon;
grant all on table public.community_posts to authenticated;
grant all on table public.community_posts to service_role;

grant all on table public.community_comments to anon;
grant all on table public.community_comments to authenticated;
grant all on table public.community_comments to service_role;

grant all on table public.notifications to anon;
grant all on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

grant all on table public.rep_availability to anon;
grant all on table public.rep_availability to authenticated;
grant all on table public.rep_availability to service_role;

grant all on table public.bookings to anon;
grant all on table public.bookings to authenticated;
grant all on table public.bookings to service_role;

-- View grants
grant all on table public.activity_log to anon;
grant all on table public.activity_log to authenticated;
grant all on table public.activity_log to service_role;

grant all on table public.companies_summary to anon;
grant all on table public.companies_summary to authenticated;
grant all on table public.companies_summary to service_role;

grant all on table public.contacts_summary to anon;
grant all on table public.contacts_summary to authenticated;
grant all on table public.contacts_summary to service_role;

grant all on table public.init_state to anon;
grant all on table public.init_state to authenticated;
grant all on table public.init_state to service_role;

-- Sequence grants
grant all on sequence public.companies_id_seq to anon;
grant all on sequence public.companies_id_seq to authenticated;
grant all on sequence public.companies_id_seq to service_role;

grant all on sequence public."contactNotes_id_seq" to anon;
grant all on sequence public."contactNotes_id_seq" to authenticated;
grant all on sequence public."contactNotes_id_seq" to service_role;

grant all on sequence public.contacts_id_seq to anon;
grant all on sequence public.contacts_id_seq to authenticated;
grant all on sequence public.contacts_id_seq to service_role;

grant all on sequence public."dealNotes_id_seq" to anon;
grant all on sequence public."dealNotes_id_seq" to authenticated;
grant all on sequence public."dealNotes_id_seq" to service_role;

grant all on sequence public.deals_id_seq to anon;
grant all on sequence public.deals_id_seq to authenticated;
grant all on sequence public.deals_id_seq to service_role;

grant all on sequence public.favicons_excluded_domains_id_seq to anon;
grant all on sequence public.favicons_excluded_domains_id_seq to authenticated;
grant all on sequence public.favicons_excluded_domains_id_seq to service_role;

grant all on sequence public.deal_payouts_id_seq to anon;
grant all on sequence public.deal_payouts_id_seq to authenticated;
grant all on sequence public.deal_payouts_id_seq to service_role;

grant all on sequence public.community_posts_id_seq to anon;
grant all on sequence public.community_posts_id_seq to authenticated;
grant all on sequence public.community_posts_id_seq to service_role;

grant all on sequence public.community_comments_id_seq to anon;
grant all on sequence public.community_comments_id_seq to authenticated;
grant all on sequence public.community_comments_id_seq to service_role;

grant all on sequence public.notifications_id_seq to anon;
grant all on sequence public.notifications_id_seq to authenticated;
grant all on sequence public.notifications_id_seq to service_role;

grant all on sequence public.rep_availability_id_seq to anon;
grant all on sequence public.rep_availability_id_seq to authenticated;
grant all on sequence public.rep_availability_id_seq to service_role;

grant all on sequence public.bookings_id_seq to anon;
grant all on sequence public.bookings_id_seq to authenticated;
grant all on sequence public.bookings_id_seq to service_role;

grant all on sequence public.sales_id_seq to anon;
grant all on sequence public.sales_id_seq to authenticated;
grant all on sequence public.sales_id_seq to service_role;

grant all on sequence public.tags_id_seq to anon;
grant all on sequence public.tags_id_seq to authenticated;
grant all on sequence public.tags_id_seq to service_role;

grant all on sequence public.tasks_id_seq to anon;
grant all on sequence public.tasks_id_seq to authenticated;
grant all on sequence public.tasks_id_seq to service_role;

-- Default privileges
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant all on sequences to authenticated;
alter default privileges for role postgres in schema public grant all on sequences to service_role;

alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public grant all on functions to anon;
alter default privileges for role postgres in schema public grant all on functions to authenticated;
alter default privileges for role postgres in schema public grant all on functions to service_role;

alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on tables to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;

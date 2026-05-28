alter table "public"."deal_payouts" add column "stripe_transfer_id" text;

alter table "public"."sales" add column "stripe_account_id" text;

alter table "public"."sales" add column "stripe_account_status" text;



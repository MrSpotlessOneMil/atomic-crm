// Outbound email via Postmark Send API.
//
// Called by Postgres triggers when a notification row is created, with a payload
// describing the notification. Looks up the recipient's email, renders a small
// HTML/text template per type, and POSTs to Postmark.
//
// Requires environment variables:
//   POSTMARK_SERVER_TOKEN  (Postmark server token for the sending stream)
//   POSTMARK_FROM_EMAIL    (verified sender address)
// Optional:
//   POSTMARK_MESSAGE_STREAM  (defaults to "outbound")
//   APP_BASE_URL             (used to build links in the email body)
//
// Without POSTMARK_SERVER_TOKEN the function returns 503 so the trigger
// fails open (the in-app notification still works).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

type NotificationType =
  | "comment_on_post"
  | "lead_assigned"
  | "payout_approved"
  | "payout_paid";

type Payload = {
  notification_id?: number | string;
  sales_id?: number | string;
  type?: NotificationType;
  payload?: Record<string, unknown>;
};

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const buildMessage = (
  type: NotificationType,
  payload: Record<string, unknown>,
  baseUrl: string,
  recipientName: string,
): { subject: string; html: string; text: string } => {
  const firstName = recipientName.split(" ")[0] || "there";
  switch (type) {
    case "lead_assigned": {
      const first = String(payload.first_name ?? "");
      const last = String(payload.last_name ?? "");
      const contactId = String(payload.contact_id ?? "");
      const link = `${baseUrl}/contacts/${encodeURIComponent(contactId)}`;
      const name = `${first} ${last}`.trim() || "a new contact";
      return {
        subject: `New lead assigned: ${name}`,
        text: `Hey ${firstName} — you've got a new lead: ${name}. Open it: ${link}`,
        html: `<p>Hey ${escape(firstName)} —</p><p>You've got a new lead: <strong>${escape(name)}</strong>.</p><p><a href="${link}">Open the contact</a></p>`,
      };
    }
    case "comment_on_post": {
      const title = String(payload.post_title ?? "your post");
      const link = `${baseUrl}/community`;
      return {
        subject: `New comment on "${title}"`,
        text: `Hey ${firstName} — someone replied to "${title}". Read it: ${link}`,
        html: `<p>Hey ${escape(firstName)} —</p><p>Someone replied to <strong>"${escape(title)}"</strong>.</p><p><a href="${link}">Read on OSIRIS community</a></p>`,
      };
    }
    case "payout_approved": {
      const amount = Number(payload.amount_cents ?? 0) / 100;
      const link = `${baseUrl}/payouts`;
      const money = amount.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
      return {
        subject: `Your payout was approved (${money})`,
        text: `Hey ${firstName} — your ${money} payout is approved and queued for payment. Details: ${link}`,
        html: `<p>Hey ${escape(firstName)} —</p><p>Your <strong>${escape(money)}</strong> payout was approved and is queued for payment.</p><p><a href="${link}">See your payouts</a></p>`,
      };
    }
    case "payout_paid": {
      const amount = Number(payload.amount_cents ?? 0) / 100;
      const link = `${baseUrl}/payouts`;
      const money = amount.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
      return {
        subject: `You got paid: ${money}`,
        text: `Hey ${firstName} — your ${money} payout is paid. Details: ${link}`,
        html: `<p>Hey ${escape(firstName)} —</p><p>Your <strong>${escape(money)}</strong> payout is paid out. Nice work.</p><p><a href="${link}">See your payouts</a></p>`,
      };
    }
    default:
      return {
        subject: "You have a new OSIRIS notification",
        text: `Hey ${firstName} — sign in to OSIRIS to see what's new.`,
        html: `<p>Hey ${escape(firstName)} —</p><p>Sign in to OSIRIS to see what's new.</p>`,
      };
  }
};

const handle = async (req: Request) => {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  const token = Deno.env.get("POSTMARK_SERVER_TOKEN");
  const from = Deno.env.get("POSTMARK_FROM_EMAIL");
  if (!token || !from) {
    return createErrorResponse(503, "Email sending not configured");
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  if (!body.sales_id || !body.type) {
    return createErrorResponse(400, "sales_id and type are required");
  }

  // Look up the recipient.
  const { data: sale, error: saleError } = await supabaseAdmin
    .from("sales")
    .select("email, first_name, last_name, disabled")
    .eq("id", Number(body.sales_id))
    .single();
  if (saleError || !sale || sale.disabled || !sale.email) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "recipient_unavailable" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const baseUrl = (Deno.env.get("APP_BASE_URL") || "").replace(/\/+$/, "");
  const stream = Deno.env.get("POSTMARK_MESSAGE_STREAM") || "outbound";
  const fullName = `${sale.first_name ?? ""} ${sale.last_name ?? ""}`.trim();
  const { subject, html, text } = buildMessage(
    body.type,
    body.payload ?? {},
    baseUrl,
    fullName,
  );

  const res = await fetch(POSTMARK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: from,
      To: sale.email,
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      MessageStream: stream,
      Tag: `osiris-${body.type}`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Postmark ${res.status}: ${detail}`);
    return createErrorResponse(502, "Postmark send failed");
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

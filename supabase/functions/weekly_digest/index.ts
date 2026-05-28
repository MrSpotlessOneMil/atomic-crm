// Weekly digest — sends each active rep a summary email of last week's wins,
// pending payouts, current streak, and upcoming bookings.
//
// Designed to be triggered by pg_cron once a week. Auth is via the
// X-OSIRIS-DIGEST-TOKEN header (set as a function secret) so the cron job can
// call it without forging a JWT. Without POSTMARK_SERVER_TOKEN /
// POSTMARK_FROM_EMAIL it returns 503 so the cron job logs the misconfig and
// no-ops.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const POSTMARK_URL = "https://api.postmarkapp.com/email/batch";

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type Sale = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  disabled: boolean;
};

const startOfLastWeek = (): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay() - 7);
  return d;
};

const endOfLastWeek = (): Date => {
  const d = startOfLastWeek();
  d.setUTCDate(d.getUTCDate() + 7);
  return d;
};

const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const formatDollarsFromUnits = (amount: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);

const buildDigestEmail = ({
  sale,
  weekWins,
  weekAmount,
  pendingPayoutCents,
  upcomingBookings,
  baseUrl,
}: {
  sale: Sale;
  weekWins: number;
  weekAmount: number;
  pendingPayoutCents: number;
  upcomingBookings: number;
  baseUrl: string;
}): {
  to: string;
  subject: string;
  html: string;
  text: string;
} => {
  const firstName = (sale.first_name ?? "").split(" ")[0] || "there";
  const wonLine =
    weekWins > 0
      ? `You closed ${weekWins} ${weekWins === 1 ? "deal" : "deals"} (${formatDollarsFromUnits(weekAmount)}) last week.`
      : `No closed-won deals last week — let's change that.`;
  const payoutLine =
    pendingPayoutCents > 0
      ? `Pending payout: ${formatMoney(pendingPayoutCents)}.`
      : `No pending payouts.`;
  const bookingLine =
    upcomingBookings > 0
      ? `${upcomingBookings} ${upcomingBookings === 1 ? "booking" : "bookings"} on the calendar this week.`
      : `No bookings on the calendar yet — share your /u/${sale.id} link.`;

  const subject = `OSIRIS weekly digest`;
  const text = [
    `Hey ${firstName},`,
    "",
    wonLine,
    payoutLine,
    bookingLine,
    "",
    `Dashboard: ${baseUrl}/`,
    `Bookings: ${baseUrl}/bookings`,
    `Payouts: ${baseUrl}/payouts`,
  ].join("\n");
  const html = `
    <p>Hey ${escape(firstName)},</p>
    <ul>
      <li>${escape(wonLine)}</li>
      <li>${escape(payoutLine)}</li>
      <li>${escape(bookingLine)}</li>
    </ul>
    <p>
      <a href="${baseUrl}/">Dashboard</a> ·
      <a href="${baseUrl}/bookings">Bookings</a> ·
      <a href="${baseUrl}/payouts">Payouts</a>
    </p>
  `;
  return { to: sale.email, subject, html, text };
};

const handle = async (req: Request) => {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }
  const expectedToken = Deno.env.get("OSIRIS_DIGEST_TOKEN");
  const providedToken = req.headers.get("X-OSIRIS-DIGEST-TOKEN");
  if (!expectedToken || providedToken !== expectedToken) {
    return createErrorResponse(401, "Unauthorized");
  }

  const postmarkToken = Deno.env.get("POSTMARK_SERVER_TOKEN");
  const fromEmail = Deno.env.get("POSTMARK_FROM_EMAIL");
  if (!postmarkToken || !fromEmail) {
    return createErrorResponse(503, "Email sending not configured");
  }

  const baseUrl = (Deno.env.get("APP_BASE_URL") || "").replace(/\/+$/, "");
  const stream = Deno.env.get("POSTMARK_MESSAGE_STREAM") || "outbound";

  const weekStart = startOfLastWeek().toISOString();
  const weekEnd = endOfLastWeek().toISOString();
  const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  const nowIso = new Date().toISOString();

  const { data: sales } = await supabaseAdmin
    .from("sales")
    .select("id, first_name, last_name, email, disabled")
    .eq("disabled", false);

  if (!sales || sales.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Gather per-rep stats.
  const messages: Array<{
    From: string;
    To: string;
    Subject: string;
    HtmlBody: string;
    TextBody: string;
    MessageStream: string;
    Tag: string;
  }> = [];

  for (const sale of sales as Sale[]) {
    const [{ data: wonDeals }, { data: payouts }, { data: bookings }] =
      await Promise.all([
        supabaseAdmin
          .from("deals")
          .select("amount")
          .eq("sales_id", sale.id)
          .eq("stage", "won")
          .gte("updated_at", weekStart)
          .lt("updated_at", weekEnd),
        supabaseAdmin
          .from("deal_payouts")
          .select("amount_cents")
          .eq("sales_id", sale.id)
          .in("status", ["pending", "approved"]),
        supabaseAdmin
          .from("bookings")
          .select("id")
          .eq("sales_id", sale.id)
          .eq("status", "scheduled")
          .gte("scheduled_for", nowIso)
          .lte("scheduled_for", inAWeek),
      ]);

    const weekWins = wonDeals?.length ?? 0;
    const weekAmount = (wonDeals ?? []).reduce(
      (sum, d) => sum + (d.amount ?? 0),
      0,
    );
    const pendingPayoutCents = (payouts ?? []).reduce(
      (sum, p) => sum + (p.amount_cents ?? 0),
      0,
    );
    const upcomingBookings = bookings?.length ?? 0;

    // Skip silent reps with nothing to say — saves sender reputation.
    if (
      weekWins === 0 &&
      pendingPayoutCents === 0 &&
      upcomingBookings === 0
    ) {
      continue;
    }

    const email = buildDigestEmail({
      sale,
      weekWins,
      weekAmount,
      pendingPayoutCents,
      upcomingBookings,
      baseUrl,
    });
    messages.push({
      From: fromEmail,
      To: email.to,
      Subject: email.subject,
      HtmlBody: email.html,
      TextBody: email.text,
      MessageStream: stream,
      Tag: "osiris-digest",
    });
  }

  if (messages.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Postmark accepts batches of up to 500.
  for (let i = 0; i < messages.length; i += 500) {
    const chunk = messages.slice(i, i + 500);
    const res = await fetch(POSTMARK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": postmarkToken,
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Postmark batch ${res.status}: ${detail}`);
      return createErrorResponse(502, "Postmark batch send failed");
    }
  }

  return new Response(
    JSON.stringify({ ok: true, sent: messages.length }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

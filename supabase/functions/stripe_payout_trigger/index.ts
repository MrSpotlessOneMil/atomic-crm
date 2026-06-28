// Trigger a Stripe transfer for an approved deal payout.
//
// POST /functions/v1/stripe_payout_trigger
//   Body: { payout_id }
//   Caller must be an admin.
//
// Creates a Stripe Transfer to the rep's connected account, then marks the
// payout as 'paid' (which fires the existing notification + email triggers)
// and stores the Stripe transfer id on stripe_transfer_id.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type User } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const STRIPE_API = "https://api.stripe.com/v1";

const formEncode = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    )
    .join("&");

const stripePost = async (
  path: string,
  body: Record<string, string>,
  token: string,
): Promise<Record<string, unknown>> => {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = (json?.error ?? {}) as { message?: string };
    throw new Error(errObj.message || `Stripe ${res.status}`);
  }
  return json;
};

const handle = async (req: Request, user?: User) => {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return createErrorResponse(503, "Stripe not configured");
  }
  if (!user) {
    return createErrorResponse(401, "Unauthorized");
  }

  const caller = await getUserSale(user);
  if (!caller?.administrator) {
    return createErrorResponse(403, "Admin only");
  }

  let body: { payout_id?: number | string };
  try {
    body = (await req.json()) as { payout_id?: number | string };
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }
  const payoutId = Number(body.payout_id);
  if (!Number.isFinite(payoutId) || payoutId <= 0) {
    return createErrorResponse(400, "payout_id required");
  }

  const { data: payout, error: payoutErr } = await supabaseAdmin
    .from("deal_payouts")
    .select("id, sales_id, amount_cents, status, stripe_transfer_id")
    .eq("id", payoutId)
    .single();
  if (payoutErr || !payout) {
    return createErrorResponse(404, "Payout not found");
  }
  if (payout.status === "paid") {
    return new Response(
      JSON.stringify({ ok: true, already: "paid" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
  if (payout.status !== "approved") {
    return createErrorResponse(400, "Payout is not approved yet");
  }

  const { data: rep, error: repErr } = await supabaseAdmin
    .from("sales")
    .select("id, stripe_account_id, disabled")
    .eq("id", payout.sales_id)
    .single();
  if (repErr || !rep) {
    return createErrorResponse(404, "Rep not found");
  }
  if (!rep.stripe_account_id) {
    return createErrorResponse(400, "Rep has not connected a Stripe account");
  }
  if (rep.disabled) {
    return createErrorResponse(400, "Rep is disabled");
  }

  let transfer: Record<string, unknown>;
  try {
    transfer = await stripePost(
      "/transfers",
      {
        amount: String(payout.amount_cents),
        currency: "usd",
        destination: rep.stripe_account_id,
        description: `Robin Line payout #${payout.id}`,
        "metadata[payout_id]": String(payout.id),
        "metadata[sales_id]": String(payout.sales_id),
      },
      stripeKey,
    );
  } catch (err) {
    console.error("stripe transfer failed", err);
    return createErrorResponse(502, (err as Error).message);
  }

  const { error: updateErr } = await supabaseAdmin
    .from("deal_payouts")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_transfer_id: String(transfer.id ?? ""),
    })
    .eq("id", payout.id);
  if (updateErr) {
    console.error("payout post-transfer update failed", updateErr);
    return createErrorResponse(500, "Could not update payout");
  }

  return new Response(
    JSON.stringify({
      ok: true,
      transfer_id: String(transfer.id ?? ""),
    }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
};

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) => UserMiddleware(req, (r, u) => handle(r, u))),
  ),
);

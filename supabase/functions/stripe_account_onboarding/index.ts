// Stripe Connect onboarding for sales reps.
//
// POST /functions/v1/stripe_account_onboarding
//   Body: {}  (caller identified by JWT)
//   Returns: { url } — Account Link the rep should open to finish onboarding.
//
// Creates an Express connected account for the rep on first call, persists
// the account id on sales.stripe_account_id, and returns an Account Link.
//
// Requires:
//   STRIPE_SECRET_KEY                  (sk_live_... or sk_test_...)
//   STRIPE_CONNECT_REFRESH_URL         (where Stripe redirects on session expiry)
//   STRIPE_CONNECT_RETURN_URL          (where Stripe redirects on success)
// Returns 503 if those secrets aren't set.

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

const handle = async (_req: Request, user?: User) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const refreshUrl = Deno.env.get("STRIPE_CONNECT_REFRESH_URL");
  const returnUrl = Deno.env.get("STRIPE_CONNECT_RETURN_URL");
  if (!stripeKey || !refreshUrl || !returnUrl) {
    return createErrorResponse(503, "Stripe Connect not configured");
  }
  if (!user) {
    return createErrorResponse(401, "Unauthorized");
  }

  const sale = await getUserSale(user);
  if (!sale) {
    return createErrorResponse(401, "Unauthorized");
  }

  // Create the connected account on first call.
  let accountId = (sale as { stripe_account_id?: string }).stripe_account_id;
  if (!accountId) {
    try {
      const account = await stripePost(
        "/accounts",
        {
          type: "express",
          email: sale.email,
          "capabilities[transfers][requested]": "true",
          country: "US",
          business_type: "individual",
        },
        stripeKey,
      );
      accountId = String(account.id);
      const { error: updateErr } = await supabaseAdmin
        .from("sales")
        .update({
          stripe_account_id: accountId,
          stripe_account_status: "pending",
        })
        .eq("id", sale.id);
      if (updateErr) {
        console.error("stripe onboarding update sale failed", updateErr);
        return createErrorResponse(500, "Could not persist account id");
      }
    } catch (err) {
      console.error("stripe account create failed", err);
      return createErrorResponse(502, "Stripe account create failed");
    }
  }

  // Generate an Account Link.
  try {
    const link = await stripePost(
      "/account_links",
      {
        account: accountId!,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      },
      stripeKey,
    );
    return new Response(
      JSON.stringify({ url: String(link.url ?? "") }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("stripe account link failed", err);
    return createErrorResponse(502, "Stripe account link failed");
  }
};

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) => UserMiddleware(req, (r, u) => handle(r, u))),
  ),
);

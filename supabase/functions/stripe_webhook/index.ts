// Stripe webhook receiver. Reconciles Stripe state back to OSIRIS:
//   account.updated         -> sales.stripe_account_status
//   transfer.reversed       -> deal_payouts.status = 'void'
//   transfer.failed         -> deal_payouts.status = 'approved' (so admin can retry)
//   payout.failed (Connect) -> alert admin (logged for now)
//
// Webhook signature verification is mandatory — Stripe rotates timestamps so
// replays beyond 5 minutes are rejected.
//
// Env vars:
//   STRIPE_SECRET_KEY            (for any follow-up API calls — not strictly required)
//   STRIPE_WEBHOOK_SECRET        (whsec_... from Stripe dashboard)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const enc = new TextEncoder();

/**
 * Verify a Stripe webhook signature. Stripe sends a header like:
 *   t=1492774577,v1=hex,v0=...
 * We compute HMAC-SHA256 of `${t}.${rawBody}` using the webhook secret and
 * compare to v1.
 */
const verifyStripeSignature = async (
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> => {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      if (i < 0) return ["", ""] as const;
      return [p.slice(0, i), p.slice(i + 1)] as const;
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${t}.${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time compare.
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
};

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

const handle = async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    return new Response("Webhook not configured", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();

  const ok = await verifyStripeSignature(raw, signature, secret);
  if (!ok) {
    console.warn("stripe_webhook: signature mismatch");
    return new Response("Invalid signature", { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const acc = event.data.object as {
          id?: string;
          charges_enabled?: boolean;
          payouts_enabled?: boolean;
          details_submitted?: boolean;
        };
        if (acc.id) {
          const status = acc.payouts_enabled
            ? "complete"
            : acc.details_submitted
              ? "pending_verification"
              : "pending";
          await supabaseAdmin
            .from("sales")
            .update({ stripe_account_status: status })
            .eq("stripe_account_id", acc.id);
        }
        break;
      }
      case "transfer.reversed":
      case "transfer.failed": {
        const t = event.data.object as {
          id?: string;
          metadata?: { payout_id?: string };
        };
        const payoutId = Number(t?.metadata?.payout_id);
        if (Number.isFinite(payoutId) && payoutId > 0) {
          const next =
            event.type === "transfer.reversed" ? "void" : "approved";
          await supabaseAdmin
            .from("deal_payouts")
            .update({
              status: next,
              paid_at: next === "void" ? null : null,
            })
            .eq("id", payoutId);
        }
        break;
      }
      case "payout.failed": {
        console.warn(
          "Stripe payout.failed received — admin should investigate",
          { event_id: event.id, object: event.data.object },
        );
        break;
      }
      default:
        // No-op for unhandled types. Stripe expects 2xx within a few seconds.
        break;
    }
  } catch (err) {
    console.error("stripe_webhook handler error", err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
};

Deno.serve(handle);

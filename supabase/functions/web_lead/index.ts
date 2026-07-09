// web_lead — PUBLIC front door for the lead-magnet website.
//
// The site can call this directly from the browser (no secret in client code).
// It applies a honeypot, then forwards server-side to lead_inbound with the
// real LEAD_INBOUND_SECRET (kept here in the function env, never exposed). This
// is how website opt-ins reach the funnel without touching the dev's Apps Script.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const LEAD_INBOUND_URL = "https://fliudmtgvnnqpnxpadwx.functions.supabase.co/functions/v1/lead_inbound";

interface Body {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  business_name?: string;
  lead_magnet?: string;
  source?: string;
  keyword?: string;
  attribution?: Record<string, unknown>; // utm/fbclid/ttclid/referrer first-touch from the browser
  website?: string; // honeypot — bots fill it, humans never see it
}

const ok = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  let body: Body;
  try {
    // Tolerate no-cors/text bodies too.
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as Body) : {};
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  // Honeypot — silently accept + drop.
  if (typeof body.website === "string" && body.website.trim().length > 0) return ok();

  const secret = Deno.env.get("LEAD_INBOUND_SECRET");
  if (!secret) return createErrorResponse(503, "Funnel not configured");

  // Accept email-only opt-ins too (they get the warm email drip); need at least
  // one channel — phone (SMS funnel) or email.
  if (!body.phone && !body.email) return createErrorResponse(400, "phone or email required");

  try {
    const res = await fetch(LEAD_INBOUND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LEAD-SECRET": secret },
      body: JSON.stringify({
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone,
        business_name: body.business_name,
        lead_magnet: body.lead_magnet,
        source: body.source || "website",
        keyword: body.keyword,
        // Whitelisted downstream (lead_inbound sanitizeAttribution) — safe to
        // pass through from the browser.
        attribution: body.attribution,
      }),
    });
    const out = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(out), {
      status: res.ok ? 200 : res.status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    console.error("[web_lead] forward failed", e);
    return createErrorResponse(502, "forward failed");
  }
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

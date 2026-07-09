// Public lead capture — anyone can POST a contact form submission.
// Creates a contact with sales_id = NULL via the service role (bypasses RLS).
// Admins see unassigned contacts and can route them to reps. Since the
// voice-memo build, quote requests also get a deal + the full drip (they used
// to sit as bare contacts with no follow-up at all).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { toE164 } from "../_shared/quoSales.ts";
import { enrollLeadCadence, ensureOpenDeal } from "../_shared/enrollment.ts";

type RequestBody = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  message?: string;
  service_interest?: "residential" | "commercial" | "recurring" | "other";
  /** Optional rep referral when the form is submitted from /u/<id>. */
  referred_by_sales_id?: number | string;
  /** Honeypot field — bots fill it, humans never see it. */
  website?: string;
};

const trim = (s: unknown, max = 200): string =>
  typeof s === "string" ? s.trim().slice(0, max) : "";

const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const handleSubmit = async (req: Request) => {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  // Honeypot check — silently accept and discard.
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const first_name = trim(body.first_name, 80);
  const last_name = trim(body.last_name, 80);
  const email = trim(body.email, 200).toLowerCase();
  const phone = trim(body.phone, 40);
  const message = trim(body.message, 2000);
  const service_interest = trim(body.service_interest, 40);

  if (!first_name || !last_name || !email) {
    return createErrorResponse(
      400,
      "first_name, last_name, and email are required",
    );
  }
  if (!isEmail(email)) {
    return createErrorResponse(400, "Invalid email");
  }

  // Resolve referral: if a sales_id was passed, verify it exists & not disabled
  // before assigning. Invalid referrals silently fall back to unassigned.
  let referredSalesId: number | null = null;
  if (body.referred_by_sales_id != null) {
    const candidate = Number(body.referred_by_sales_id);
    if (Number.isFinite(candidate) && candidate > 0) {
      const { data: sale } = await supabaseAdmin
        .from("sales")
        .select("id, disabled")
        .eq("id", candidate)
        .single();
      if (sale && !sale.disabled) {
        referredSalesId = sale.id;
      }
    }
  }

  const background = [
    service_interest ? `Service interest: ${service_interest}` : "",
    message ? `Message: ${message}` : "",
    referredSalesId != null
      ? `Source: rep profile (/u/${referredSalesId})`
      : "Source: public Robin Line lead form",
  ]
    .filter(Boolean)
    .join("\n");

  const e164 = toE164(phone);
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      first_name,
      last_name,
      email_jsonb: [{ email, type: "Work" }],
      phone_jsonb: e164 ? [{ number: e164, type: "Work" }] : null,
      lead_source: "website",
      background,
      attribution: {
        platform: "website",
        lead_magnet: "quote request",
        ...(service_interest ? { keyword: service_interest } : {}),
        first_touch_at: new Date().toISOString(),
      },
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      sales_id: referredSalesId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("public_lead insert failed", error);
    return createErrorResponse(500, "Failed to record lead");
  }

  // Quote requests are the hottest leads this form sees — put them on the
  // kanban and the full drip (identity dedupe + flood cap live in enrollment).
  const contactId = data?.id as number;
  const dealId = await ensureOpenDeal({
    contactId,
    name: `${first_name} ${last_name}`.trim() || email,
    source: "website",
  });
  const enrolled = await enrollLeadCadence({
    contactId,
    dealId,
    source: "website",
    magnet: "quote request",
    e164: e164 || null,
    email,
  });

  return new Response(JSON.stringify({ ok: true, id: contactId, enqueued: enrolled.enqueued }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, (req) => handleSubmit(req)),
);

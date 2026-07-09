// meta_leads — native Meta (Facebook/Instagram) Lead Ads webhook.
//
// Replaces the Zapier direct-insert path (which wrote contacts with NO drip
// and NO ad attribution). Meta pings this on every leadgen submission; we pull
// the full lead from the Graph API (field_data + ad/adset/campaign names +
// platform), derive the offer from the ad naming, and forward it into
// lead_inbound — so Meta leads get the exact same dedupe + contact/deal
// creation + full drip (SMS, email, double-dial calls) as every other door.
//
// Meta-side setup (Meta App -> Webhooks -> Page, subscribe field "leadgen";
// subscribe the Robin Line page to the app; generate a never-expiring page
// token). Secrets live in integration_secrets so they're editable without a
// redeploy:
//   META_VERIFY_TOKEN — any random string, echoed in the GET subscribe check
//   META_APP_SECRET   — the app secret, verifies X-Hub-Signature-256
//   META_PAGE_TOKEN   — page access token with leads_retrieval
//
// Idempotent: each Graph lead carries a leadgen_id; we skip any id already
// stamped on a contact's attribution (webhook redeliveries + Zapier overlap
// are both harmless — identity dedupe in lead_inbound covers the rest).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { leadToInboundPayload, type GraphLead } from "./mapLead.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

async function getSecret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? "0" + hex : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// X-Hub-Signature-256: "sha256=<hex hmac-sha256 of raw body, keyed by app secret>".
async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
    const provided = hexToBytes(header.slice("sha256=".length));
    if (provided.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig[i] ^ provided[i];
    return diff === 0;
  } catch (e) {
    console.error("[meta_leads] verify error", e);
    return false;
  }
}

// True when the lead was ingested (or safely skipped); false = transient
// failure, make Meta redeliver.
async function processLeadgen(leadgenId: string, pageToken: string, leadSecret: string): Promise<boolean> {
  // Idempotency: already ingested this leadgen_id?
  const { data: seen } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("attribution->>leadgen_id", leadgenId)
    .limit(1);
  if (seen && seen.length) {
    console.warn("[meta_leads] leadgen already ingested - skipping duplicate", { leadgenId });
    return true;
  }

  const res = await fetch(
    `${GRAPH}/${leadgenId}?fields=${encodeURIComponent(
      "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data",
    )}&access_token=${encodeURIComponent(pageToken)}`,
  );
  if (!res.ok) {
    const body = await res.text();
    // Test-tool leads (Lead Ads Testing) 404 after a while - don't retry forever.
    if (res.status === 404 || res.status === 400) {
      console.warn("[meta_leads] graph lookup rejected - skipping", { leadgenId, status: res.status, body: body.slice(0, 300) });
      return true;
    }
    console.error("[meta_leads] graph lookup failed", { leadgenId, status: res.status, body: body.slice(0, 300) });
    return false;
  }
  const lead = (await res.json()) as GraphLead;
  const payload = leadToInboundPayload(lead, leadgenId);
  if (!payload) {
    console.warn("[meta_leads] lead has no phone or email - skipping", { leadgenId });
    return true;
  }

  // Forward through the single front door so dedupe + deal + full drip are
  // identical to every other lead source.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const fwd = await fetch(`${supabaseUrl}/functions/v1/lead_inbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LEAD-SECRET": leadSecret },
    body: JSON.stringify(payload),
  });
  if (!fwd.ok) {
    console.error("[meta_leads] lead_inbound forward failed", { leadgenId, status: fwd.status, body: (await fwd.text()).slice(0, 300) });
    return false;
  }
  const out = await fwd.json();
  console.warn("[meta_leads] ingested", { leadgenId, contact_id: out?.contact_id, enqueued: out?.enqueued });
  return true;
}

const handle = async (req: Request) => {
  // Meta's one-time webhook subscription handshake.
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const expected = await getSecret("META_VERIFY_TOKEN");
    if (mode === "subscribe" && expected && token === expected) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return createErrorResponse(403, "Verification failed");
  }

  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  const appSecret = await getSecret("META_APP_SECRET");
  const pageToken = await getSecret("META_PAGE_TOKEN");
  const leadSecret = Deno.env.get("LEAD_INBOUND_SECRET");
  if (!appSecret || !pageToken || !leadSecret) {
    console.error("[meta_leads] not configured (META_APP_SECRET / META_PAGE_TOKEN / LEAD_INBOUND_SECRET)");
    return createErrorResponse(503, "Not configured");
  }

  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret))) {
    return createErrorResponse(401, "Bad signature");
  }

  let body: { object?: string; entry?: { changes?: { field?: string; value?: { leadgen_id?: string | number } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return createErrorResponse(400, "Invalid JSON");
  }

  const leadgenIds: string[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change?.value?.leadgen_id;
      if (change?.field === "leadgen" && id) leadgenIds.push(String(id));
    }
  }

  let allOk = true;
  for (const id of leadgenIds) {
    try {
      if (!(await processLeadgen(id, pageToken, leadSecret))) allOk = false;
    } catch (e) {
      console.error("[meta_leads] processing threw", { id, e });
      allOk = false;
    }
  }

  // Non-2xx makes Meta redeliver later; the leadgen_id idempotency guard makes
  // redelivery safe for the leads that DID land.
  if (!allOk) return createErrorResponse(500, "Partial failure - retry");
  return new Response(JSON.stringify({ ok: true, processed: leadgenIds.length }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

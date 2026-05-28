// Inbound lead reply handler — when a prospect emails or replies to a rep
// (forwarded via a Postmark inbound stream), this function locates the rep
// (by To: email) and the contact (by From: email), then creates a
// contact_note attributed to that contact + rep.
//
// Configure Postmark to deliver inbound replies to:
//   POST /functions/v1/inbound_lead_reply
//
// Auth is via Basic + IP allowlist (same pattern as the existing postmark
// inbound function). Env vars:
//   POSTMARK_WEBHOOK_USER, POSTMARK_WEBHOOK_PASSWORD,
//   POSTMARK_WEBHOOK_AUTHORIZED_IPS (comma-separated)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const webhookUser = Deno.env.get("POSTMARK_WEBHOOK_USER");
const webhookPassword = Deno.env.get("POSTMARK_WEBHOOK_PASSWORD");
if (!webhookUser || !webhookPassword) {
  throw new Error(
    "Missing POSTMARK_WEBHOOK_USER or POSTMARK_WEBHOOK_PASSWORD env variable",
  );
}
const allowedIPs = (Deno.env.get("POSTMARK_WEBHOOK_AUTHORIZED_IPS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const expectedAuth =
  "Basic " + btoa(`${webhookUser}:${webhookPassword}`);

type PostmarkInbound = {
  From?: string;
  FromFull?: { Email?: string; Name?: string };
  ToFull?: Array<{ Email?: string; Name?: string }>;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageID?: string;
};

const stripQuotedTail = (text: string): string => {
  // Heuristically remove the bottom-quoted "On Mon, ... wrote:" trail.
  const markers = [
    /^On .+wrote:\s*$/m,
    /^-----Original Message-----/m,
    /^From: .+$/m,
  ];
  let cut = text.length;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut).trim();
};

const handle = async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // IP check
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() ?? "";
  if (allowedIPs.length > 0 && !allowedIPs.includes(ip)) {
    return new Response("Unauthorized IP", { status: 401 });
  }
  // Basic auth check
  if (req.headers.get("authorization") !== expectedAuth) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: PostmarkInbound;
  try {
    body = (await req.json()) as PostmarkInbound;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const fromEmail = (body.FromFull?.Email ?? body.From ?? "").toLowerCase();
  const fromName = body.FromFull?.Name ?? "";
  if (!fromEmail) {
    return new Response("No sender email", { status: 403 });
  }

  // Locate the rep — the first To: that matches a sales row.
  const recipientEmails = (body.ToFull ?? [])
    .map((r) => (r.Email ?? "").toLowerCase())
    .filter(Boolean);
  if (recipientEmails.length === 0) {
    return new Response("No recipient", { status: 403 });
  }

  const { data: sales } = await supabaseAdmin
    .from("sales")
    .select("id, email, disabled")
    .in("email", recipientEmails);
  const rep = (sales ?? []).find((s) => !s.disabled);
  if (!rep) {
    // Not addressed to any active rep — let Postmark know to stop retrying.
    return new Response("No matching rep", { status: 403 });
  }

  // Locate the contact under that rep by email; create a stub contact if
  // none exists.
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id, sales_id")
    .eq("sales_id", rep.id)
    .contains("email_jsonb", [{ email: fromEmail }])
    .limit(1);

  let contactId: number;
  if (existing && existing.length > 0) {
    contactId = existing[0].id as number;
  } else {
    const name = (fromName || "").trim();
    const [first, ...rest] = name.split(/\s+/);
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: first || fromEmail.split("@")[0],
        last_name: rest.join(" ") || "",
        email_jsonb: [{ email: fromEmail, type: "Work" }],
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        sales_id: rep.id,
        background: "Auto-created from inbound email reply",
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("inbound_lead_reply: contact insert failed", insertErr);
      return new Response("Internal error", { status: 500 });
    }
    contactId = inserted.id as number;
  }

  const rawText = (body.TextBody ?? "").trim();
  const cleanText = stripQuotedTail(rawText);
  const noteHeader = body.Subject ? `Subject: ${body.Subject}\n\n` : "";
  const noteBody = `${noteHeader}${cleanText}`.slice(0, 8000);

  const { error: noteErr } = await supabaseAdmin
    .from("contact_notes")
    .insert({
      contact_id: contactId,
      text: noteBody,
      date: new Date().toISOString(),
      sales_id: rep.id,
      status: "warm",
    });
  if (noteErr) {
    console.error("inbound_lead_reply: note insert failed", noteErr);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, contact_id: contactId }), {
    headers: { "Content-Type": "application/json" },
  });
};

Deno.serve(handle);

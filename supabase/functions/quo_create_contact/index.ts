import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const QUO_BASE = "https://api.openphone.com/v1";

function toE164(raw?: string | null): string {
  if (!raw) return "";
  const t = raw.trim();
  if (t.startsWith("+")) return "+" + t.replace(/\D/g, "");
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

async function getQuoKey(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "QUO_API_KEY")
    .single();
  return data?.value ?? null;
}

// Mirror a CRM contact into OpenPhone so the name shows up there on calls/texts.
// Called by the DB trigger on contact insert (no user auth needed).
Deno.serve((req: Request) =>
  OptionsMiddleware(req, async (req) => {
    if (req.method !== "POST") {
      return createErrorResponse(405, "Method Not Allowed");
    }
    const { first_name, last_name, phone, email, company, external_id } =
      await req.json();
    const key = await getQuoKey();
    if (!key) return createErrorResponse(503, "Quo not configured");

    const phoneNumbers = phone
      ? [{ name: "Work", value: toE164(phone) }]
      : [];
    const emails = email ? [{ name: "Work", value: email }] : [];

    // Need at least a phone or email for the contact to be useful in OpenPhone.
    if (phoneNumbers.length === 0 && emails.length === 0) {
      return new Response(JSON.stringify({ data: "skipped (no phone/email)" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const body = {
      defaultFields: {
        firstName: first_name || company || "Lead",
        lastName: last_name || "",
        company: company || "",
        phoneNumbers,
        emails,
      },
      source: "Robin Line CRM",
      ...(external_id ? { externalId: String(external_id).slice(0, 75) } : {}),
    };

    const res = await fetch(`${QUO_BASE}/contacts`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Quo create contact failed", res.status, resBody);
      return createErrorResponse(res.status, "Quo rejected the contact.");
    }
    return new Response(JSON.stringify({ data: resBody }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }),
);

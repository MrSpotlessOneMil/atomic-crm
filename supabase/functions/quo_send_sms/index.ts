import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";

const QUO_ENDPOINT = "https://api.openphone.com/v1/messages";

// Accept any US phone format and coerce to E.164 (what Quo requires).
function toE164(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return "+" + trimmed.replace(/\D/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

async function getQuoKey(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "QUO_API_KEY")
    .single();
  return data?.value ?? null;
}

async function sendSms(req: Request, sale: any) {
  const { to, content, contact_id } = await req.json();

  if (!to || !content) {
    return createErrorResponse(400, "Both 'to' and 'content' are required.");
  }
  const toNumber = toE164(to);
  const from = toE164(sale.quo_phone);
  if (!from) {
    return createErrorResponse(
      400,
      "You haven't set your Quo phone number yet. Add it in your profile.",
    );
  }
  const key = await getQuoKey();
  if (!key) {
    return createErrorResponse(
      500,
      "Quo is not configured. Ask an admin to set the Quo API key.",
    );
  }

  const quoRes = await fetch(QUO_ENDPOINT, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ content, from, to: [toNumber] }),
  });

  const quoBody = await quoRes.json().catch(() => ({}));
  if (!quoRes.ok) {
    console.error("Quo send failed:", quoRes.status, quoBody);
    return createErrorResponse(
      quoRes.status,
      (quoBody as any)?.message ?? "Failed to send the text via Quo.",
    );
  }

  // Best-effort: log the sent text on the contact's timeline so it's visible
  // to the rep and admin. Never fail the send if logging fails.
  if (contact_id) {
    try {
      await supabaseAdmin.from("contact_notes").insert({
        contact_id,
        sales_id: sale.id,
        text: `📱 Text sent to ${to}:\n${content}`,
        date: new Date().toISOString(),
        status: "warm",
      });
    } catch (e) {
      console.error("Could not log sent text as a note:", e);
    }
  }

  return new Response(JSON.stringify({ data: quoBody }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) =>
      UserMiddleware(req, async (req, user) => {
        const sale = await getUserSale(user);
        if (!sale) {
          return createErrorResponse(401, "Unauthorized");
        }
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        return sendSms(req, sale);
      }),
    ),
  ),
);

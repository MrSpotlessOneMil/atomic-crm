import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";

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

// List the rep's conversations (one per lead they've texted/called), ordered by
// most recent activity — the Quo/OpenPhone inbox view.
async function listConversations(sale: any) {
  const from = toE164(sale.quo_phone);
  if (!from) {
    return createErrorResponse(400, "Set your Quo number in your profile first.");
  }
  const key = await getQuoKey();
  if (!key) return createErrorResponse(503, "Quo is not configured.");

  // Resolve the rep's phoneNumberId (PN...) from their E.164 number.
  const pnRes = await fetch(`${QUO_BASE}/phone-numbers`, {
    headers: { Authorization: key },
  });
  const pnBody = await pnRes.json();
  const numbers = Array.isArray(pnBody?.data) ? pnBody.data : pnBody ?? [];
  const pn = numbers.find((p: any) => toE164(p.number) === from);
  if (!pn) {
    return createErrorResponse(
      400,
      "Your Quo number isn't on the connected account.",
    );
  }

  // OpenPhone returns conversations filtered by the OpenPhone number (E.164),
  // already carrying a lastActivityAt we can sort on.
  const url = `${QUO_BASE}/conversations?phoneNumbers[]=${encodeURIComponent(
    from,
  )}&maxResults=100`;
  const cRes = await fetch(url, { headers: { Authorization: key } });
  const cBody = await cRes.json();
  if (!cRes.ok) {
    console.error("Quo list conversations failed", cRes.status, cBody);
    return createErrorResponse(cRes.status, "Could not load conversations.");
  }

  const rows = Array.isArray(cBody?.data) ? cBody.data : [];
  const conversations = rows
    .map((c: any) => {
      const participants: string[] = Array.isArray(c.participants)
        ? c.participants.map((p: any) => toE164(typeof p === "string" ? p : p?.phoneNumber))
        : [];
      // The "other party" is any participant that isn't the rep's own number.
      const other = participants.find((p) => p && p !== from) ?? participants[0] ?? "";
      return {
        id: c.id ?? other,
        phone: other,
        name: c.name ?? null,
        lastActivityAt: c.lastActivityAt ?? c.updatedAt ?? c.createdAt ?? null,
      };
    })
    .filter((c: any) => c.phone)
    .sort((a: any, b: any) =>
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
    );

  return new Response(JSON.stringify({ data: conversations }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) =>
      UserMiddleware(req, async (req, user) => {
        const sale = await getUserSale(user);
        if (!sale) return createErrorResponse(401, "Unauthorized");
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        return listConversations(sale);
      }),
    ),
  ),
);

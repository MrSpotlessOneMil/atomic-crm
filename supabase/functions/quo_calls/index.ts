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

async function listCalls(req: Request, sale: any) {
  const { to } = await req.json();
  const contactNumber = toE164(to);
  const from = toE164(sale.quo_phone);
  if (!from) {
    return createErrorResponse(400, "Set your Quo number in your profile first.");
  }
  if (!contactNumber) {
    return createErrorResponse(400, "This lead has no phone number.");
  }
  const key = await getQuoKey();
  if (!key) return createErrorResponse(503, "Quo is not configured.");
  const headers = { Authorization: key };

  const pnRes = await fetch(`${QUO_BASE}/phone-numbers`, { headers });
  const pnBody = await pnRes.json();
  const numbers = Array.isArray(pnBody?.data) ? pnBody.data : pnBody ?? [];
  const pn = numbers.find((p: any) => toE164(p.number) === from);
  if (!pn) {
    return createErrorResponse(
      400,
      "Your Quo number isn't on the connected account.",
    );
  }

  const callsRes = await fetch(
    `${QUO_BASE}/calls?phoneNumberId=${encodeURIComponent(
      pn.id,
    )}&participants=${encodeURIComponent(contactNumber)}&maxResults=15`,
    { headers },
  );
  const callsBody = await callsRes.json();
  if (!callsRes.ok) {
    console.error("Quo list calls failed", callsRes.status, callsBody);
    return createErrorResponse(callsRes.status, "Could not load calls.");
  }
  const calls = Array.isArray(callsBody?.data) ? callsBody.data : [];

  // Enrich each call with its recording URL + transcript (in parallel).
  const enriched = await Promise.all(
    calls.map(async (c: any) => {
      const [recRes, transRes] = await Promise.all([
        fetch(`${QUO_BASE}/call-recordings/${c.id}`, { headers })
          .then((r) => r.json())
          .catch(() => ({})),
        fetch(`${QUO_BASE}/call-transcripts/${c.id}`, { headers })
          .then((r) => r.json())
          .catch(() => ({})),
      ]);
      const recordingUrl = recRes?.data?.[0]?.url ?? null;
      const dialogue = transRes?.data?.dialogue ?? [];
      const transcript = dialogue
        .map((d: any) => d.content)
        .filter(Boolean)
        .join(" ");
      return {
        id: c.id,
        direction: c.direction,
        status: c.status,
        createdAt: c.createdAt,
        duration: c.duration ?? null,
        recordingUrl,
        transcript,
      };
    }),
  );
  enriched.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return new Response(JSON.stringify({ data: enriched }), {
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
        return listCalls(req, sale);
      }),
    ),
  ),
);

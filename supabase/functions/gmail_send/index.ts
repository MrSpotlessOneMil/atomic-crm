import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";

async function secret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

function base64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendEmail(req: Request, sale: any) {
  const { to, subject, body, contact_id } = await req.json();
  if (!to || !subject || !body) {
    return createErrorResponse(400, "to, subject and body are all required.");
  }

  const { data: tok } = await supabaseAdmin
    .from("gmail_tokens")
    .select("refresh_token, email")
    .eq("sales_id", sale.id)
    .single();
  if (!tok?.refresh_token) {
    return createErrorResponse(
      400,
      "Gmail isn't connected. Connect it on your profile first.",
    );
  }

  const clientId = await secret("GOOGLE_CLIENT_ID");
  const clientSecret = await secret("GOOGLE_CLIENT_SECRET");

  // Refresh an access token.
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      refresh_token: tok.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const refreshed = await refreshRes.json();
  if (!refreshRes.ok || !refreshed.access_token) {
    console.error("Token refresh failed:", refreshed);
    return createErrorResponse(
      502,
      "Could not reach Gmail. Try reconnecting Gmail on your profile.",
    );
  }

  const from = tok.email ?? sale.email;
  const mime = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");

  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64url(mime) }),
    },
  );
  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    console.error("Gmail send failed:", sendRes.status, JSON.stringify(sendBody));
    const detail =
      (sendBody as any)?.error?.message ??
      (sendBody as any)?.error?.errors?.[0]?.message ??
      "Gmail rejected the message.";
    return createErrorResponse(sendRes.status, `Gmail: ${detail}`);
  }

  // Log on the contact's timeline when we have one.
  if (contact_id) {
    try {
      await supabaseAdmin.from("contact_notes").insert({
        contact_id,
        sales_id: sale.id,
        text: `📧 Email sent to ${to}\nSubject: ${subject}\n\n${body}`,
        date: new Date().toISOString(),
        status: "warm",
      });
    } catch (e) {
      console.error("Could not log sent email:", e);
    }
  }

  return new Response(JSON.stringify({ data: sendBody }), {
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
        return sendEmail(req, sale);
      }),
    ),
  ),
);

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const APP_URL = "https://osiris-crm.vercel.app";

async function secret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

function redirect(path: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${APP_URL}/#/${path}` } });
}

// Google redirects the rep here after they approve. We exchange the code for a
// refresh token and attach it to the matching sales rep (by email).
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) {
    return redirect("?gmail=denied");
  }
  const code = url.searchParams.get("code");
  if (!code) return redirect("?gmail=error");

  const clientId = await secret("GOOGLE_CLIENT_ID");
  const clientSecret = await secret("GOOGLE_CLIENT_SECRET");
  const redirectUri = await secret("GOOGLE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    return redirect("?gmail=error");
  }

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error("Token exchange failed:", tokens);
    return redirect("?gmail=error");
  }

  // Who connected? Get their Google email.
  const uiRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await uiRes.json();
  const email: string | undefined = userInfo?.email;
  if (!email) return redirect("?gmail=error");

  // Match to the sales rep with the same email.
  const { data: sale } = await supabaseAdmin
    .from("sales")
    .select("id")
    .ilike("email", email)
    .single();
  if (!sale) return redirect("?gmail=nomatch");

  await supabaseAdmin
    .from("gmail_tokens")
    .upsert({
      sales_id: sale.id,
      email,
      refresh_token: tokens.refresh_token,
      updated_at: new Date().toISOString(),
    });
  await supabaseAdmin
    .from("sales")
    .update({ gmail_connected: true })
    .eq("id", sale.id);

  return redirect("?gmail=connected");
});

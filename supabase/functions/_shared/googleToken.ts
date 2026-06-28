// Mint a short-lived Google access token from a sales rep's stored refresh
// token (gmail_tokens). Reuses the same OAuth client the Gmail connect flow
// already uses (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in integration_secrets).
//
// The refresh token must have been granted the scope you need — for Calendar
// reads the rep has to re-consent with calendar.readonly added.

import { supabaseAdmin } from "./supabaseAdmin.ts";

async function secret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

export interface GoogleToken {
  access_token?: string;
  email?: string;
  error?: string;
}

export async function getGoogleAccessToken(salesId: number): Promise<GoogleToken> {
  const { data: tok } = await supabaseAdmin
    .from("gmail_tokens")
    .select("refresh_token, email")
    .eq("sales_id", salesId)
    .single();
  if (!tok?.refresh_token) return { error: `no Google refresh token for sales_id ${salesId}` };

  const clientId = await secret("GOOGLE_CLIENT_ID");
  const clientSecret = await secret("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { error: "GOOGLE_CLIENT_ID/SECRET not set" };

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tok.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    return { error: `token refresh failed: ${JSON.stringify(j).slice(0, 200)}` };
  }
  return { access_token: j.access_token as string, email: tok.email ?? undefined };
}

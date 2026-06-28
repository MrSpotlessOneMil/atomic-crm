// Lead enrichment — turn a bare phone number + first text into a real name and
// company. OpenPhone gives us NO caller identity, so we extract it from what the
// lead sends: a website they text (fetched + read) and/or names in the message.
// Reuses the same Claude Haiku extraction approach as ai_extract_contact.

import { supabaseAdmin } from "./supabaseAdmin.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export interface Identity {
  first_name: string;
  last_name: string;
  company_name: string;
  email: string;
  title: string;
  notes: string;
}

const EMPTY: Identity = { first_name: "", last_name: "", company_name: "", email: "", title: "", notes: "" };

const EXTRACT_SYSTEM = `You extract CRM lead info from a cleaning-company owner's text message and/or their website. The lead is a cleaning business or its owner.
Return ONLY a JSON object, no prose, with these keys (use "" when unknown):
{"company_name":"","first_name":"","last_name":"","email":"","title":"","notes":""}
- company_name: the cleaning business name.
- first_name/last_name: the person (owner/contact). If only a full name, split it.
- notes: a 1-2 sentence summary of who they are / what they do.
Be accurate; NEVER invent names, emails, or companies that are not clearly present. If nothing is identifiable, return all "".`;

async function anthropicKey(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_secrets")
    .select("value")
    .eq("key", "ANTHROPIC_API_KEY")
    .single();
  return data?.value ?? Deno.env.get("ANTHROPIC_API_KEY") ?? null;
}

// First http(s)/www URL in a text, trimmed of trailing punctuation.
export function findUrl(text: string): string | null {
  const m = text.match(/\b((?:https?:\/\/|www\.)[^\s]+)/i);
  if (!m) return null;
  let u = m[1].replace(/[)\].,!?'"]+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// Fetch a URL and return readable text (tags stripped). Null on any failure.
// Guarded: http(s) only, 6s timeout, html/plain only, size-capped.
export async function fetchSiteText(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: { "User-Agent": "RobinLineBot/1.0" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const html = (await res.text()).slice(0, 200_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 4000) || null;
  } catch {
    return null;
  }
}

export async function extractIdentity(text: string): Promise<Identity> {
  const key = await anthropicKey();
  if (!key || !text.trim()) return { ...EMPTY };
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: EXTRACT_SYSTEM,
        messages: [{ role: "user", content: text.slice(0, 8000) }],
      }),
    });
    if (!res.ok) return { ...EMPTY };
    const body = await res.json();
    const raw = body?.content?.[0]?.text ?? "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    return {
      first_name: s(parsed.first_name, 80),
      last_name: s(parsed.last_name, 80),
      company_name: s(parsed.company_name, 120),
      email: s(parsed.email, 200),
      title: s(parsed.title, 120),
      notes: s(parsed.notes, 500),
    };
  } catch {
    return { ...EMPTY };
  }
}

// Enrich from a lead's first inbound message: fetch any URL they sent, then
// extract name/company from the message + site together.
export async function enrichFromMessage(text: string): Promise<Identity> {
  const url = findUrl(text);
  let combined = `Their text message: "${text.slice(0, 1000)}"`;
  if (url) {
    const site = await fetchSiteText(url);
    if (site) combined += `\n\nTheir website (${url}):\n${site}`;
  }
  return await extractIdentity(combined);
}

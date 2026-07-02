// enrich_contacts — backfill REAL owner first names onto cold-list contacts that
// only have a business name (see the 219 leads whose first_name held the company
// name). For each such contact we look up the owner/founder via Apollo (matched
// by the company's website DOMAIN — the reliable key) and write their real
// first/last name + title. The opener then greets "Hi Mike," instead of the
// greetingName() fallback of "there".
//
// Auth: X-DISPATCH-TOKEN == DISPATCH_TASKS_TOKEN (internal, same as the cron fns).
// Apollo key: APOLLO_API_KEY in integration_secrets.
//
// SAFE-BY-DEFAULT: pass {"dry_run": true} to fetch + report names WITHOUT writing
// or spending beyond the searches, and a small {"limit": 3} to test cheaply first.
// Idempotent: only picks contacts whose name still looks like a business, so
// re-running continues where it left off.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const BIZ_WORDS = /\b(cleaning|clean|services?|company|co|llc|inc|maids?|janitorial|solutions?|group|enterprises?|cleaners?|detailing|team)\b/i;

// Does this first_name still look like a business (so it needs a real name)?
function needsName(first: string | null | undefined, companyName?: string | null): boolean {
  const f = (first ?? "").trim();
  if (!f) return true;
  const parts = f.split(/\s+/);
  if (/^(the|a|an)$/i.test(parts[0])) return true;
  if (parts.length >= 3) return true;
  if (BIZ_WORDS.test(f)) return true;
  if (companyName && f.toLowerCase() === companyName.trim().toLowerCase()) return true;
  return false;
}

function domainOf(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getSecret(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("integration_secrets").select("value").eq("key", key).single();
  return data?.value ?? null;
}

interface OwnerHit { first_name?: string; last_name?: string; title?: string; none?: boolean; error?: string; }

// Apollo people search, matched by the org domain, biased to decision-maker titles.
async function apolloOwner(domain: string, apiKey: string): Promise<OwnerHit> {
  const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apiKey },
    body: JSON.stringify({
      q_organization_domains: domain,
      person_titles: ["owner", "founder", "co-founder", "ceo", "president", "principal", "managing member", "operations manager"],
      page: 1,
      per_page: 1,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { error: `apollo ${res.status}: ${JSON.stringify(j).slice(0, 160)}` };
  const p = Array.isArray(j?.people) && j.people[0] ? j.people[0] : null;
  if (!p || !p.first_name) return { none: true };
  return { first_name: p.first_name, last_name: p.last_name ?? "", title: p.title ?? "" };
}

const handle = async (req: Request) => {
  if (req.method !== "POST") return createErrorResponse(405, "Method Not Allowed");

  // Platform auth (verify_jwt) gates the endpoint; runs via `supabase functions
  // invoke`. Because this spends Apollo credits + rewrites names, WRITES require
  // an explicit confirm:true — dry_run previews are always allowed.
  let body: { limit?: number; dry_run?: boolean; confirm?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limit = Math.max(1, Math.min(100, Number(body.limit) || 25));
  const dryRun = body.dry_run === true;
  if (!dryRun && body.confirm !== true) {
    return createErrorResponse(400, "Refusing to write without confirm:true (or pass dry_run:true to preview)");
  }

  const apiKey = await getSecret("APOLLO_API_KEY");
  if (!apiKey) return createErrorResponse(503, "APOLLO_API_KEY not set in integration_secrets");

  // Pull cold contacts with a linked company; filter to the ones that still need
  // a real name and have a domain to match on.
  const { data: rows, error } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, company_id, companies(name, website)")
    .is("lead_source", null)
    .not("company_id", "is", null)
    .limit(800);
  if (error) return createErrorResponse(500, `contacts query failed: ${error.message}`);

  const candidates = (rows ?? [])
    .map((r) => {
      const co = (r as { companies?: { name?: string; website?: string } }).companies;
      return { id: r.id as number, first_name: r.first_name as string | null, company: co?.name ?? null, domain: domainOf(co?.website) };
    })
    .filter((r) => r.domain && needsName(r.first_name, r.company))
    .slice(0, limit);

  const results: Array<Record<string, unknown>> = [];
  let enriched = 0, noMatch = 0, errors = 0;

  for (const c of candidates) {
    const hit = await apolloOwner(c.domain, apiKey);
    if (hit.error) {
      errors++;
      results.push({ id: c.id, company: c.company, domain: c.domain, status: "error", detail: hit.error });
      continue;
    }
    if (hit.none || !hit.first_name) {
      noMatch++;
      results.push({ id: c.id, company: c.company, domain: c.domain, status: "no_match" });
      continue;
    }
    const first = titleCase(hit.first_name);
    const last = hit.last_name ? titleCase(hit.last_name) : null;
    if (!dryRun) {
      await supabaseAdmin.from("contacts").update({
        first_name: first,
        last_name: last,
        title: hit.title || null,
      }).eq("id", c.id);
    }
    enriched++;
    results.push({ id: c.id, company: c.company, domain: c.domain, status: dryRun ? "would_enrich" : "enriched", name: `${first} ${last ?? ""}`.trim(), title: hit.title });
  }

  return new Response(
    JSON.stringify({ ok: true, dry_run: dryRun, candidates: candidates.length, enriched, no_match: noMatch, errors, results }, null, 2),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

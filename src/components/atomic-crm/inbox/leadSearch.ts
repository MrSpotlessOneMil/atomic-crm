// Pure search/dedup logic for the Inbox lead list. Extracted from InboxPage so
// it can be unit-tested without a browser or data provider.
//
// A "lead" is anything textable: a CRM contact (what the funnel creates), a CRM
// company, or an OpenPhone number not yet in the CRM (a "quo-" id). The inbox
// is contact-first — a rep searching a name / number / email must find the
// contact, not just a company that happens to share the number.

import type { Company, Contact } from "../types";
import { toE164 } from "../misc/phone";

export type Lead = {
  id: string;
  name: string;
  phone_number: string;
  crmPath?: string;
  contactId?: number;
  companyId?: number;
  // Lowercased "name + emails" text haystack and a separate digits-only phone
  // string, precomputed so the search filter stays cheap. Phones live ONLY in
  // _digits (never _blob) so the 3-digit guard actually holds — otherwise a
  // 2-char query would substring-match the number sitting in the text.
  _blob?: string;
  _digits?: string;
};

export const onlyDigits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

// Unified textable-lead list: contacts first (deduped by E.164 so several rows
// on one number collapse to the most-recent — callers pass contacts sorted
// last_seen DESC), then any company whose number a contact didn't already
// cover. Each lead carries its search haystack.
export function buildLeads(
  contacts: Contact[] | undefined,
  companies: Company[] | undefined,
): Lead[] {
  const list: Lead[] = [];
  const seen = new Set<string>();

  for (const c of contacts ?? []) {
    const numbers = (c.phone_jsonb ?? [])
      .map((p) => p?.number)
      .filter((n): n is string => !!n);
    if (!numbers.length) continue; // the inbox is for texting; skip no-phone
    const e164 = toE164(numbers[0]);
    if (e164 && seen.has(e164)) continue;
    const name =
      `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || e164 || "Lead";
    const emails = (c.email_jsonb ?? [])
      .map((e) => e?.email)
      .filter((e): e is string => !!e);
    list.push({
      id: `contact-${c.id}`,
      name,
      phone_number: e164 || numbers[0],
      crmPath: `/contacts/${c.id}/show`,
      contactId: Number(c.id),
      _blob: [name, ...emails].join(" ").toLowerCase(),
      _digits: numbers.map(onlyDigits).join(" "),
    });
    if (e164) seen.add(e164);
  }

  for (const co of companies ?? []) {
    const e164 = toE164(co.phone_number);
    if (e164 && seen.has(e164)) continue;
    const name = co.name || e164 || "Lead";
    list.push({
      id: `company-${co.id}`,
      name,
      phone_number: co.phone_number || e164,
      crmPath: `/companies/${co.id}/show`,
      companyId: Number(co.id),
      _blob: name.toLowerCase(),
      _digits: onlyDigits(co.phone_number),
    });
    if (e164) seen.add(e164);
  }

  return list;
}

// Match ANY lead by name, phone (any format), or email. A digits query only
// matches phones when it's at least 3 digits, so "41" doesn't match every
// number; text still matches the blob (names, emails).
export function filterLeads(leads: Lead[], rawQuery: string): Lead[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const qDigits = onlyDigits(query);
  return leads.filter(
    (l) =>
      (l._blob ?? "").includes(query) ||
      (qDigits.length >= 3 && (l._digits ?? "").includes(qDigits)),
  );
}

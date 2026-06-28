import type { Identifier } from "ra-core";
import { getSupabaseClient } from "../providers/supabase/supabase";

// Find or create a contact for a company so an interaction (text/email/call)
// has something to attach to, and claim the lead for the rep if it's unclaimed.
// Returns the contact id.
export async function ensureContactForCompany(opts: {
  companyId: Identifier;
  companyName: string;
  phone?: string | null;
  salesId?: Identifier;
}): Promise<number> {
  const sb = getSupabaseClient();
  const { data: existing } = await sb
    .from("contacts")
    .select("id")
    .eq("company_id", opts.companyId)
    .limit(1);
  let contactId = existing?.[0]?.id as number | undefined;
  if (!contactId) {
    const { data: created, error } = await sb
      .from("contacts")
      .insert({
        first_name: opts.companyName,
        last_name: "",
        company_id: opts.companyId,
        status: "warm",
        phone_jsonb: opts.phone
          ? [{ number: opts.phone, type: "Work" }]
          : [],
      })
      .select("id")
      .single();
    if (error) throw error;
    contactId = created.id;
  }
  // Claim the lead for whoever's working it (only if still unclaimed).
  if (opts.salesId) {
    await sb
      .from("companies")
      .update({ sales_id: opts.salesId })
      .eq("id", opts.companyId)
      .is("sales_id", null);
  }
  if (contactId == null) throw new Error("Could not resolve a contact.");
  return contactId;
}

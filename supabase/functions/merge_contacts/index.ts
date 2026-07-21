// merge_contacts — merges one contact into another, behind the CRM UI's
// "Merge with another contact" button.
//
// The merge itself runs through the SQL merge_two_contacts() function: the SAME
// lossless path the automatic phone de-dup sweeper uses. That matters — SIX of
// the nine tables referencing contacts cascade on delete, so the old
// implementation here (which only reassigned tasks, notes and deals before
// deleting the loser) silently destroyed the loser's text messages, call logs,
// scheduled follow-ups and AI conversation transcript.
//
// The button still earns its place next to the automatic sweeper: the sweeper
// only merges contacts that share a PHONE NUMBER, so duplicates with different
// numbers, a typo'd number, or no phone at all can only be merged here, by a
// human who can tell they're the same person.
//
// Authorization: merge_two_contacts is SECURITY DEFINER and deliberately NOT
// executable by `authenticated`, so we cannot run it with the caller's session.
// Instead we first check the CALLER's own RLS visibility on BOTH contacts
// (contacts are owner-or-admin), and only then perform the privileged merge
// with the service role.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }

        let body: { loserId?: unknown; winnerId?: unknown };
        try {
          body = await req.json();
        } catch {
          return createErrorResponse(400, "Invalid JSON");
        }

        const winnerId = Number(body?.winnerId);
        const loserId = Number(body?.loserId);
        if (!Number.isFinite(winnerId) || !Number.isFinite(loserId)) {
          return createErrorResponse(400, "Missing loserId or winnerId");
        }
        if (winnerId === loserId) {
          return createErrorResponse(400, "Cannot merge a contact into itself");
        }

        // Authorize AS THE CALLER: RLS on contacts is owner-or-admin, so a rep
        // may only merge records they can actually see. Both must come back.
        const authHeader = req.headers.get("Authorization") ?? "";
        const asUser = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SB_PUBLISHABLE_KEY") ?? "",
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: visible, error: visibilityError } = await asUser
          .from("contacts")
          .select("id")
          .in("id", [winnerId, loserId]);
        if (visibilityError) {
          console.error(
            "[merge_contacts] visibility check failed",
            visibilityError,
          );
          return createErrorResponse(500, "Could not verify contact access");
        }
        if (!visible || visible.length < 2) {
          return createErrorResponse(
            403,
            "You don't have access to both contacts",
          );
        }

        // Lossless merge: reassigns every child table, unions the arrays, fills
        // the winner's null fields, then deletes the loser.
        const { error } = await supabaseAdmin.rpc("merge_two_contacts", {
          p_winner: winnerId,
          p_loser: loserId,
        });
        if (error) {
          console.error("[merge_contacts] merge failed", error);
          return createErrorResponse(
            500,
            `Failed to merge contacts: ${error.message}`,
          );
        }

        return new Response(JSON.stringify({ success: true, winnerId }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }),
    ),
  ),
);

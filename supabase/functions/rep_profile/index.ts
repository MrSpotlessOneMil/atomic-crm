// Public rep profile — exposes a limited view of a sales rep (name, avatar,
// closed-won stats) so reps can share /u/<sales_id> on social. No JWT required.
// Returns only safe public fields — never the email, user_id, or admin flag.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";

const handle = async (req: Request) => {
  if (req.method !== "GET") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  const url = new URL(req.url);
  // Path looks like /functions/v1/rep_profile/<sales_id>
  const parts = url.pathname.split("/").filter(Boolean);
  const raw = parts[parts.length - 1];
  const salesId = Number(raw);
  if (!Number.isFinite(salesId) || salesId <= 0) {
    return createErrorResponse(400, "Invalid sales id");
  }

  const { data: sale, error } = await supabaseAdmin
    .from("sales")
    .select("id, first_name, last_name, avatar, disabled")
    .eq("id", salesId)
    .single();
  if (error || !sale || sale.disabled) {
    return createErrorResponse(404, "Not Found");
  }

  const { data: wonDeals } = await supabaseAdmin
    .from("deals")
    .select("amount, updated_at")
    .eq("sales_id", salesId)
    .eq("stage", "won")
    .limit(5000);

  const { data: availability } = await supabaseAdmin
    .from("rep_availability")
    .select("day_of_week, start_time, end_time")
    .eq("sales_id", salesId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  const wonCount = wonDeals?.length ?? 0;
  const wonAmount = (wonDeals ?? []).reduce(
    (sum, d) => sum + (d.amount ?? 0),
    0,
  );

  // Streak: consecutive weeks (backwards from this week) with at least one win.
  const weeksWith = new Set<string>();
  for (const d of wonDeals ?? []) {
    if (!d.updated_at) continue;
    const ref = new Date(d.updated_at);
    ref.setUTCHours(0, 0, 0, 0);
    const dow = ref.getUTCDay();
    ref.setUTCDate(ref.getUTCDate() - dow);
    weeksWith.add(ref.toISOString().slice(0, 10));
  }
  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
  while (streak < 12) {
    const key = cursor.toISOString().slice(0, 10);
    if (weeksWith.has(key)) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 7);
    } else {
      break;
    }
  }

  const badges: string[] = [];
  if (wonCount >= 1 && streak === 0) badges.push("First win");
  if (streak >= 2) badges.push(`${streak}-week streak`);
  if (wonCount >= 10) badges.push("Closer");
  if (wonAmount >= 10_000) badges.push("$10k club");
  if (wonAmount >= 50_000) badges.push("$50k club");

  return new Response(
    JSON.stringify({
      id: sale.id,
      first_name: sale.first_name,
      last_name: sale.last_name,
      avatar: sale.avatar,
      wonCount,
      wonAmount,
      streak,
      badges,
      availability: availability ?? [],
    }),
    {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
};

Deno.serve((req: Request) => OptionsMiddleware(req, handle));

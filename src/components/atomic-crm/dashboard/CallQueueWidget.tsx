import { Check, PhoneCall, UserPlus } from "lucide-react";
import { useGetIdentity } from "ra-core";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getSupabaseClient } from "../providers/supabase/supabase";

type CallItem = {
  id: number;
  text: string;
  due_date: string;
  contact_id: number;
  sales_id: number | null;
  name: string;
  phone: string | null;
  overdue: boolean;
};

const firstPhoneOf = (jsonb: unknown): string | null => {
  if (!Array.isArray(jsonb)) return null;
  for (const entry of jsonb) {
    if (typeof entry === "string" && entry.trim()) return entry;
    const n = (entry as { number?: unknown })?.number;
    if (typeof n === "string" && n.trim()) return n;
  }
  return null;
};

// CALL NOW queue: due / overdue double-dial tasks bridged in by the funnel's
// call cadence (dispatch_tasks -> tasks type 'call'). Shows the rep's own items
// plus the unassigned pool, so fresh leads get dialed even before assignment.
// Done = the rep called (Log Call also auto-closes these); Claim = take a pool
// lead.
export const CallQueueWidget = () => {
  const { identity } = useGetIdentity();
  const [items, setItems] = useState<CallItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!identity?.id) return;
    const sb = getSupabaseClient();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const { data: tasks } = await sb
      .from("tasks")
      .select("id, text, due_date, contact_id, sales_id")
      .eq("type", "call")
      .is("done_date", null)
      .lte("due_date", endOfToday.toISOString())
      .or(`sales_id.eq.${identity.id},sales_id.is.null`)
      .order("due_date", { ascending: true })
      .limit(15);

    const rows = tasks ?? [];
    const contactIds = [...new Set(rows.map((t: any) => t.contact_id))].filter(
      Boolean,
    );
    const details = new Map<number, { name: string; phone: string | null }>();
    if (contactIds.length) {
      const { data: contacts } = await sb
        .from("contacts_summary")
        .select("id, first_name, last_name, company_name, phone_jsonb")
        .in("id", contactIds);
      (contacts ?? []).forEach((c: any) => {
        const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
        details.set(c.id, {
          name: full || c.company_name || "Lead",
          phone: firstPhoneOf(c.phone_jsonb),
        });
      });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    setItems(
      rows.map((t: any) => ({
        id: t.id,
        text: t.text,
        due_date: t.due_date,
        contact_id: t.contact_id,
        sales_id: t.sales_id,
        name: details.get(t.contact_id)?.name ?? "Lead",
        phone: details.get(t.contact_id)?.phone ?? null,
        overdue: new Date(t.due_date) < startOfToday,
      })),
    );
    setLoaded(true);
  }, [identity?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const markDone = async (id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await getSupabaseClient()
      .from("tasks")
      .update({ done_date: new Date().toISOString() })
      .eq("id", id);
  };

  const claim = async (id: number) => {
    if (!identity?.id) return;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, sales_id: identity.id as number } : i)),
    );
    await getSupabaseClient()
      .from("tasks")
      .update({ sales_id: identity.id })
      .eq("id", id);
  };

  if (!loaded || items.length === 0) return null;

  return (
    <Card className="p-4 border-red-400/50 bg-red-50/40 dark:bg-red-950/10">
      <div className="flex items-center gap-2 mb-3">
        <PhoneCall className="w-5 h-5 text-red-500" />
        <h2 className="text-base font-semibold">Call now ({items.length})</h2>
        <span className="text-xs text-muted-foreground">
          double dial: call twice back-to-back
        </span>
      </div>
      <div className="flex flex-col divide-y">
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-3 py-2">
            <button
              type="button"
              onClick={() => markDone(i.id)}
              title="Mark called"
              className="shrink-0 w-5 h-5 rounded-full border border-muted-foreground/40 hover:bg-primary hover:text-primary-foreground hover:border-primary flex items-center justify-center transition-colors"
            >
              <Check className="w-3 h-3" />
            </button>
            <Link
              to={`/contacts/${i.contact_id}/show`}
              className="flex-1 min-w-0 hover:underline"
            >
              <div className="text-sm font-medium truncate">{i.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {i.text}
              </div>
            </Link>
            {i.phone ? (
              <a
                href={`tel:${i.phone}`}
                className="shrink-0 text-xs font-medium text-primary hover:underline flex items-center gap-1"
              >
                <PhoneCall className="w-3 h-3" />
                {i.phone}
              </a>
            ) : null}
            {i.sales_id == null ? (
              <button
                type="button"
                onClick={() => claim(i.id)}
                title="Claim this lead"
                className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border hover:bg-muted flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3" />
                Claim
              </button>
            ) : null}
            <span
              className={cn(
                "shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full",
                i.overdue
                  ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
              )}
            >
              {i.overdue ? "Overdue" : "Today"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};

import { BellRing, Check } from "lucide-react";
import { useGetIdentity } from "ra-core";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getSupabaseClient } from "../providers/supabase/supabase";

type FollowUp = {
  id: number;
  text: string;
  due_date: string;
  contact_id: number;
  name: string;
  overdue: boolean;
};

// Surfaces the rep's due / overdue follow-up reminders front-and-center so
// "reach out in a week" leads actually resurface instead of dying.
export const FollowUpsWidget = () => {
  const { identity } = useGetIdentity();
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!identity?.id) return;
    const sb = getSupabaseClient();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const { data: tasks } = await sb
      .from("tasks")
      .select("id, text, due_date, contact_id")
      .eq("sales_id", identity.id)
      .is("done_date", null)
      .lte("due_date", endOfToday.toISOString())
      .order("due_date", { ascending: true })
      .limit(15);

    const rows = tasks ?? [];
    const contactIds = [...new Set(rows.map((t: any) => t.contact_id))].filter(
      Boolean,
    );
    const names = new Map<number, string>();
    if (contactIds.length) {
      const { data: contacts } = await sb
        .from("contacts_summary")
        .select("id, first_name, last_name, company_name")
        .in("id", contactIds);
      (contacts ?? []).forEach((c: any) => {
        const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
        names.set(c.id, c.company_name || full || "Lead");
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
        name: names.get(t.contact_id) ?? "Lead",
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

  if (!loaded || items.length === 0) return null;

  return (
    <Card className="p-4 border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/10">
      <div className="flex items-center gap-2 mb-3">
        <BellRing className="w-5 h-5 text-amber-500" />
        <h2 className="text-base font-semibold">
          Follow-ups due ({items.length})
        </h2>
      </div>
      <div className="flex flex-col divide-y">
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-3 py-2">
            <button
              type="button"
              onClick={() => markDone(i.id)}
              title="Mark done"
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

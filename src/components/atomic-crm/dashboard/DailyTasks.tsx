import { CheckCircle2, Circle, Target } from "lucide-react";
import { useGetIdentity, useGetList } from "ra-core";
import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { getSupabaseClient } from "../providers/supabase/supabase";
import type { Deal } from "../types";

// The daily scorecard, straight from the SDR playbook. Reps check these off and
// we persist per day (table public.daily_progress) so progress is tracked.
const ITEMS = [
  { key: "booked", label: "Book 2+ appointments today (target 2–3)", star: true },
  { key: "dials", label: "~60 dials in the peak windows (10–12 & 1–4 local)" },
  { key: "dms", label: "~40 personalized DMs (warm signals first, then cold)" },
  { key: "inbound", label: "Every inbound DM answered" },
  { key: "engaged", label: "All commenters / likers / followers / viewers worked" },
  { key: "confirmations", label: "Today's confirmations sent · tomorrow's queued" },
  { key: "logged", label: "Every touch logged · your number updated" },
];

const WEEKLY_GOAL = 8;

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export const DailyTasks = () => {
  const { identity } = useGetIdentity();
  const salesId = identity?.id;
  const today = localDate();
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  // Their number: demos booked/showed/won this... (lifetime proxy; weekly view
  // comes with the closed-loop later).
  const { total } = useGetList<Deal>(
    "deals",
    {
      pagination: { page: 1, perPage: 1 },
      filter: salesId
        ? { sales_id: salesId, "stage@in": "(demo-booked,demo-done,won)" }
        : {},
    },
    { enabled: !!salesId },
  );
  const booked = total ?? 0;

  useEffect(() => {
    if (!salesId) return;
    let active = true;
    getSupabaseClient()
      .from("daily_progress")
      .select("items")
      .eq("sales_id", salesId)
      .eq("date", today)
      .maybeSingle()
      .then(({ data }: { data: { items?: Record<string, boolean> } | null }) => {
        if (active) {
          setItems(data?.items ?? {});
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [salesId, today]);

  const toggle = async (key: string) => {
    if (!salesId || !loaded) return;
    const next = { ...items, [key]: !items[key] };
    setItems(next);
    await getSupabaseClient()
      .from("daily_progress")
      .upsert(
        {
          sales_id: salesId,
          date: today,
          items: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "sales_id,date" },
      );
  };

  const doneCount = ITEMS.filter((i) => items[i.key]).length;
  const pct = Math.round((doneCount / ITEMS.length) * 100);

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Today's Tasks</h2>
            <span className="text-sm text-muted-foreground">
              {doneCount}/{ITEMS.length} done
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-primary">{booked}</span> /{" "}
            {WEEKLY_GOAL} demos
          </div>
        </div>

        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ul className="space-y-0.5">
          {ITEMS.map((item) => {
            const done = !!items[item.key];
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => toggle(item.key)}
                  disabled={!loaded}
                  className="w-full flex items-center gap-3 text-left py-2 px-2 rounded-md hover:bg-muted/50 disabled:opacity-60"
                >
                  {done ? (
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                  )}
                  <span
                    className={
                      done
                        ? "line-through text-muted-foreground text-sm"
                        : item.star
                          ? "font-semibold text-sm"
                          : "text-sm"
                    }
                  >
                    {item.star ? "★ " : ""}
                    {item.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          Resets each morning. Clear the list by end of day — outcome first, then
          the floor.
        </p>
      </CardContent>
    </Card>
  );
};

import { Flame, Medal, PhoneCall, Trophy } from "lucide-react";
import { useGetList } from "ra-core";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ContactNote, Deal, Sale } from "../types";

type Range = "week" | "month" | "all";

type LeaderRow = {
  sale: Sale;
  wonCount: number;
  wonAmount: number;
  callCount: number;
  streak: number;
  badges: string[];
};

// A logged call is a contact note whose text starts with the phone marker
// written by the Log Call button ("📞 … called").
const isCallNote = (text?: string | null): boolean =>
  typeof text === "string" && text.trimStart().startsWith("📞");

const formatMoney = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const startOfRange = (range: Range): Date | null => {
  if (range === "all") return null;
  const now = new Date();
  if (range === "week") {
    const d = new Date(now);
    const dow = d.getDay();
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
};

/**
 * Streak = number of consecutive weeks (counting backwards from this week)
 * during which the rep closed at least one deal. Caps at 12 for display.
 */
const computeStreak = (closedDates: Date[]): number => {
  if (closedDates.length === 0) return 0;
  const weeksWith = new Set<string>();
  for (const d of closedDates) {
    const ref = new Date(d);
    ref.setHours(0, 0, 0, 0);
    const dow = ref.getDay();
    ref.setDate(ref.getDate() - dow);
    weeksWith.add(ref.toISOString().slice(0, 10));
  }
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  while (streak < 12) {
    const key = cursor.toISOString().slice(0, 10);
    if (weeksWith.has(key)) {
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    } else {
      break;
    }
  }
  return streak;
};

const computeBadges = (row: Omit<LeaderRow, "badges">): string[] => {
  const out: string[] = [];
  if (row.wonCount >= 1 && row.streak === 0) out.push("First win");
  if (row.streak >= 2) out.push(`${row.streak}-week streak`);
  if (row.wonCount >= 10) out.push("Closer");
  if (row.wonAmount >= 10_000) out.push("$10k club");
  if (row.wonAmount >= 50_000) out.push("$50k club");
  return out;
};

export const LeaderboardPage = () => {
  const [range, setRange] = useState<Range>("month");

  const { data: sales, isPending: salesLoading } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "id", order: "ASC" },
  });

  const { data: deals, isPending: dealsLoading } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 5000 },
    filter: { stage: "won" },
    sort: { field: "updated_at", order: "DESC" },
  });

  // Every rep's logged calls, used to surface "calls made" on the board.
  const { data: notes, isPending: notesLoading } = useGetList<ContactNote>(
    "contact_notes",
    {
      pagination: { page: 1, perPage: 5000 },
      sort: { field: "date", order: "DESC" },
    },
  );

  const rows: LeaderRow[] = useMemo(() => {
    if (!sales || !deals) return [];
    const cutoff = startOfRange(range);
    const inRange = (d: Deal): boolean => {
      if (!cutoff) return true;
      const closed = new Date(d.updated_at);
      return closed >= cutoff;
    };
    const callInRange = (n: ContactNote): boolean => {
      if (!cutoff) return true;
      return new Date(n.date) >= cutoff;
    };
    const callNotes = (notes ?? []).filter((n) => isCallNote(n.text));
    return (sales ?? [])
      .filter((s) => !s.disabled)
      .map((sale) => {
        const wonAll = (deals ?? []).filter(
          (deal) => deal.sales_id === sale.id,
        );
        const wonInRange = wonAll.filter(inRange);
        const wonAmount = wonInRange.reduce(
          (sum, d) => sum + (d.amount ?? 0),
          0,
        );
        const callCount = callNotes.filter(
          (n) => n.sales_id === sale.id && callInRange(n),
        ).length;
        const streak = computeStreak(
          wonAll.map((d) => new Date(d.updated_at)),
        );
        const base = {
          sale,
          wonCount: wonInRange.length,
          wonAmount,
          callCount,
          streak,
        };
        return { ...base, badges: computeBadges(base) };
      })
      .sort((a, b) => b.wonAmount - a.wonAmount || b.wonCount - a.wonCount);
  }, [sales, deals, notes, range]);

  const isPending = salesLoading || dealsLoading || notesLoading;
  // Show the full roster as soon as reps exist — everyone appears, even at zero
  // wins, so the whole team is always visible on the board.
  const hasRoster = rows.length > 0;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Robin Line leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              Closed-won deals across the team. Climb the chart by closing more.
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/deals">Open pipeline</Link>
        </Button>
      </header>

      <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
        <TabsList>
          <TabsTrigger value="week">This week</TabsTrigger>
          <TabsTrigger value="month">This month</TabsTrigger>
          <TabsTrigger value="all">All time</TabsTrigger>
        </TabsList>
      </Tabs>

      {isPending ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : !hasRoster ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-base font-medium">No reps yet.</p>
            <p className="text-sm text-muted-foreground">
              Once your team signs up they'll show up here.
            </p>
            <div className="pt-2">
              <Button asChild>
                <Link to="/contacts/create">Add your first contact</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ol className="divide-y">
              {rows.map((row, idx) => (
                <li
                  key={row.sale.id}
                  className="flex items-center gap-4 px-6 py-4"
                >
                  <RankBadge rank={idx + 1} />
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={row.sale.avatar?.src} />
                    <AvatarFallback>
                      {(row.sale.first_name?.[0] ?? "") +
                        (row.sale.last_name?.[0] ?? "")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {row.sale.first_name} {row.sale.last_name}
                      {row.sale.administrator ? (
                        <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">
                          admin
                        </span>
                      ) : null}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {row.wonCount} {row.wonCount === 1 ? "win" : "wins"}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <PhoneCall className="w-3 h-3" />
                        {row.callCount}{" "}
                        {row.callCount === 1 ? "call" : "calls"}
                      </span>
                      {row.streak >= 2 ? (
                        <span className="flex items-center gap-1 text-xs text-orange-500">
                          <Flame className="w-3 h-3" />
                          {row.streak}w
                        </span>
                      ) : null}
                      {row.badges.slice(0, 2).map((b) => (
                        <Badge key={b} variant="secondary" className="text-xs">
                          {b}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatMoney(row.wonAmount)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

LeaderboardPage.path = "/leaderboard";

const RankBadge = ({ rank }: { rank: number }) => {
  if (rank === 1) {
    return (
      <div className="w-8 h-8 rounded-full bg-yellow-500/10 flex items-center justify-center">
        <Medal className="w-4 h-4 text-yellow-500" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-8 h-8 rounded-full bg-zinc-400/10 flex items-center justify-center">
        <Medal className="w-4 h-4 text-zinc-400" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-600/10 flex items-center justify-center">
        <Medal className="w-4 h-4 text-amber-600" />
      </div>
    );
  }
  return (
    <span className="w-8 text-center font-semibold text-muted-foreground">
      {rank}
    </span>
  );
};

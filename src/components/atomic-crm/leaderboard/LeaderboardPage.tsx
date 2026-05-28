import { Trophy } from "lucide-react";
import { useGetList } from "ra-core";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import type { Deal, Sale } from "../types";

type LeaderRow = {
  sale: Sale;
  wonCount: number;
  wonAmount: number;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

export const LeaderboardPage = () => {
  const { data: sales, isPending: salesLoading } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "id", order: "ASC" },
  });

  const { data: deals, isPending: dealsLoading } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 1000 },
    filter: { stage: "won" },
    sort: { field: "updated_at", order: "DESC" },
  });

  if (salesLoading || dealsLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading…</div>
    );
  }

  const rows: LeaderRow[] = (sales ?? [])
    .filter((sale) => !sale.disabled)
    .map((sale) => {
      const wonDeals = (deals ?? []).filter((deal) => deal.sales_id === sale.id);
      return {
        sale,
        wonCount: wonDeals.length,
        wonAmount: wonDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      };
    })
    .sort((a, b) => b.wonAmount - a.wonAmount || b.wonCount - a.wonCount);

  const hasAnyWins = rows.some((r) => r.wonCount > 0);

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">OSIRIS leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              Closed-won deals across the team. Climb the chart by closing more.
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/deals">Open pipeline</Link>
        </Button>
      </header>

      {!hasAnyWins ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-base font-medium">No wins yet.</p>
            <p className="text-sm text-muted-foreground">
              Be the first to close a deal and you'll show up here.
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
                  <span
                    className={
                      "w-8 text-center font-semibold " +
                      (idx === 0
                        ? "text-yellow-500"
                        : idx === 1
                          ? "text-zinc-400"
                          : idx === 2
                            ? "text-amber-600"
                            : "text-muted-foreground")
                    }
                  >
                    {idx + 1}
                  </span>
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
                    <p className="text-xs text-muted-foreground">
                      {row.wonCount} {row.wonCount === 1 ? "win" : "wins"}
                    </p>
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

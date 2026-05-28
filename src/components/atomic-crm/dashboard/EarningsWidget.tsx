import { DollarSign, ExternalLink } from "lucide-react";
import { useGetList } from "ra-core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import type { DealPayout } from "../types";

const formatMoney = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

export const EarningsWidget = () => {
  const { data: payouts, isPending } = useGetList<DealPayout>("deal_payouts", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "created_at", order: "DESC" },
  });

  const totals = (payouts ?? []).reduce(
    (acc, p) => {
      if (p.status === "paid") acc.paid += p.amount_cents;
      else if (p.status === "approved") acc.approved += p.amount_cents;
      else if (p.status === "pending") acc.pending += p.amount_cents;
      return acc;
    },
    { paid: 0, approved: 0, pending: 0 },
  );

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Earnings
            </h2>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to="/payouts">
              <ExternalLink className="w-3 h-3" />
            </Link>
          </Button>
        </div>
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-2">
            <Row label="Paid" value={formatMoney(totals.paid)} bold />
            <Row label="Approved" value={formatMoney(totals.approved)} />
            <Row label="Pending" value={formatMoney(totals.pending)} muted />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const Row = ({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) => (
  <div className="flex items-center justify-between text-sm">
    <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
    <span className={bold ? "font-semibold" : ""}>{value}</span>
  </div>
);

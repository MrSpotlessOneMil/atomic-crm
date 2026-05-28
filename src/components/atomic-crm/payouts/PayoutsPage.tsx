import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Check,
  Clock,
  DollarSign,
  Download,
  Hourglass,
} from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useGetMany,
  useNotify,
} from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Deal, DealPayout, DealPayoutStatus, Sale } from "../types";

const STATUS_LABEL: Record<DealPayoutStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  void: "Void",
};

const STATUS_VARIANT: Record<
  DealPayoutStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  approved: "default",
  paid: "outline",
  void: "destructive",
};

const formatMoney = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);

const csvEscape = (value: unknown): string => {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const downloadCsv = (filename: string, rows: string[][]) => {
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const PayoutsPage = () => {
  const { identity } = useGetIdentity();
  const isAdmin = !!(identity as { administrator?: boolean })?.administrator;

  const { data: payouts, isPending } = useGetList<DealPayout>("deal_payouts", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "created_at", order: "DESC" },
  });

  const dealIds = Array.from(
    new Set((payouts ?? []).map((p) => p.deal_id)),
  );
  const { data: deals } = useGetMany<Deal>(
    "deals",
    { ids: dealIds },
    { enabled: dealIds.length > 0 },
  );
  const dealById = new Map((deals ?? []).map((d) => [String(d.id), d]));

  const salesIds = Array.from(
    new Set((payouts ?? []).map((p) => p.sales_id)),
  );
  const { data: salesPeople } = useGetMany<Sale>(
    "sales",
    { ids: salesIds },
    { enabled: isAdmin && salesIds.length > 0 },
  );
  const saleById = new Map(
    (salesPeople ?? []).map((s) => [String(s.id), s]),
  );

  const handleExport = () => {
    const header = isAdmin
      ? [
          "Payout ID",
          "Created",
          "Status",
          "Rep",
          "Deal",
          "Commission rate",
          "Amount (USD)",
          "Approved at",
          "Paid at",
        ]
      : [
          "Payout ID",
          "Created",
          "Status",
          "Deal",
          "Commission rate",
          "Amount (USD)",
          "Approved at",
          "Paid at",
        ];
    const rows: string[][] = [header];
    for (const p of payouts ?? []) {
      const deal = dealById.get(String(p.deal_id));
      const dealLabel = deal?.name ?? `Deal #${p.deal_id}`;
      const sale = saleById.get(String(p.sales_id));
      const repLabel = sale
        ? `${sale.first_name ?? ""} ${sale.last_name ?? ""}`.trim()
        : `Sales #${p.sales_id}`;
      const baseCols = [
        String(p.id),
        p.created_at,
        p.status,
        ...(isAdmin ? [repLabel] : []),
        dealLabel,
        `${(p.commission_rate * 100).toFixed(2)}%`,
        (p.amount_cents / 100).toFixed(2),
        p.approved_at ?? "",
        p.paid_at ?? "",
      ];
      rows.push(baseCols);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`osiris-payouts-${stamp}.csv`, rows);
  };

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
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Payouts</h1>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? "All payouts across the team. Approve and mark paid as you go."
                : "Your commission on every closed-won deal."}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={!payouts || payouts.length === 0}
        >
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          icon={Hourglass}
          label="Pending"
          value={formatMoney(totals.pending)}
        />
        <SummaryCard
          icon={Clock}
          label="Approved"
          value={formatMoney(totals.approved)}
        />
        <SummaryCard
          icon={Banknote}
          label="Paid"
          value={formatMoney(totals.paid)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isPending ? (
            <div className="py-10 text-center text-muted-foreground">
              Loading…
            </div>
          ) : !payouts || payouts.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              No payouts yet. Win a deal and one will show up here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  {isAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => {
                  const deal = dealById.get(String(p.deal_id));
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {deal?.name ?? `Deal #${p.deal_id}`}
                      </TableCell>
                      <TableCell>{formatMoney(p.amount_cents)}</TableCell>
                      <TableCell>
                        {(p.commission_rate * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[p.status]}>
                          {STATUS_LABEL[p.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(p.created_at).toLocaleDateString()}
                      </TableCell>
                      {isAdmin ? (
                        <TableCell className="text-right">
                          <AdminActions payout={p} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

PayoutsPage.path = "/payouts";

const SummaryCard = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
}) => (
  <Card>
    <CardContent className="py-6 flex items-center gap-4">
      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p className="text-xl font-semibold">{value}</p>
      </div>
    </CardContent>
  </Card>
);

const AdminActions = ({ payout }: { payout: DealPayout }) => {
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const queryClient = useQueryClient();

  const { mutate: approve, isPending: approving } = useMutation({
    mutationFn: () =>
      dataProvider.update("deal_payouts", {
        id: payout.id,
        data: { status: "approved", approved_at: new Date().toISOString() },
        previousData: payout,
      }),
    onSuccess: () => {
      notify("crm.payouts.approved", {
        messageArgs: { _: "Payout approved" },
      });
      queryClient.invalidateQueries({ queryKey: ["deal_payouts"] });
    },
    onError: () =>
      notify("crm.payouts.error", {
        type: "error",
        messageArgs: { _: "Failed to update payout" },
      }),
  });

  const { mutate: markPaid, isPending: marking } = useMutation({
    mutationFn: async () => {
      // Try Stripe transfer first. Falls back to a plain DB mark-paid if the
      // function is unavailable (503) or the rep hasn't connected Stripe.
      try {
        const supabase = (
          dataProvider as unknown as { __testSupabase?: never }
        ) as never;
        void supabase;
      } catch {
        // ignore
      }
      const supabaseClient = (
        await import("../providers/supabase/supabase")
      ).getSupabaseClient();
      const { error } = await supabaseClient.functions.invoke(
        "stripe_payout_trigger",
        { method: "POST", body: { payout_id: payout.id } },
      );
      if (error) {
        const status = (error as { context?: { status?: number } })?.context
          ?.status;
        // 503 = stripe not configured. 400 = rep hasn't onboarded. Fall back
        // to a plain mark-paid in both cases.
        if (status === 503 || status === 400) {
          await dataProvider.update("deal_payouts", {
            id: payout.id,
            data: { status: "paid", paid_at: new Date().toISOString() },
            previousData: payout,
          });
          return { fallback: true } as const;
        }
        throw new Error("stripe_payout_trigger failed");
      }
      return { fallback: false } as const;
    },
    onSuccess: (res) => {
      notify("crm.payouts.paid", {
        messageArgs: {
          _: res.fallback
            ? "Payout marked paid (Stripe not configured for this rep)"
            : "Payout paid via Stripe",
        },
      });
      queryClient.invalidateQueries({ queryKey: ["deal_payouts"] });
    },
    onError: (e: Error) =>
      notify("crm.payouts.error", {
        type: "error",
        messageArgs: { _: e.message || "Failed to update payout" },
      }),
  });

  if (payout.status === "paid" || payout.status === "void") return null;

  return (
    <div className="flex justify-end gap-2">
      {payout.status === "pending" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => approve()}
          disabled={approving}
        >
          <Check className="w-3 h-3 mr-1" />
          Approve
        </Button>
      ) : null}
      {payout.status === "approved" ? (
        <Button size="sm" onClick={() => markPaid()} disabled={marking}>
          <Banknote className="w-3 h-3 mr-1" />
          Mark paid
        </Button>
      ) : null}
    </div>
  );
};

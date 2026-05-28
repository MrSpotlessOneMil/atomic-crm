import {
  Banknote,
  CalendarCheck,
  CheckCircle2,
  MessageSquare,
  Trophy,
  UserPlus,
} from "lucide-react";
import { useGetIdentity, useGetList } from "ra-core";
import { useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";

import type {
  Booking,
  Deal,
  DealPayout,
  Notification,
} from "../types";

type FeedEvent = {
  id: string;
  ts: string;
  icon: typeof Trophy;
  iconClass: string;
  title: string;
  detail?: string;
};

const formatRelative = (iso: string): string => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
};

const formatMoneyFromUnits = (units: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(units);

const formatMoneyFromCents = (cents: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);

export const PersonalActivityFeed = () => {
  const { identity } = useGetIdentity();

  const { data: wonDeals } = useGetList<Deal>(
    "deals",
    {
      pagination: { page: 1, perPage: 20 },
      sort: { field: "updated_at", order: "DESC" },
      filter: { stage: "won" },
    },
    { enabled: !!identity?.id },
  );

  const { data: payouts } = useGetList<DealPayout>(
    "deal_payouts",
    {
      pagination: { page: 1, perPage: 20 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: !!identity?.id },
  );

  const { data: bookings } = useGetList<Booking>(
    "bookings",
    {
      pagination: { page: 1, perPage: 20 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: !!identity?.id },
  );

  const { data: notifs } = useGetList<Notification>(
    "notifications",
    {
      pagination: { page: 1, perPage: 20 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: !!identity?.id },
  );

  const events: FeedEvent[] = useMemo(() => {
    const out: FeedEvent[] = [];
    (wonDeals ?? []).forEach((d) => {
      out.push({
        id: `deal-${d.id}`,
        ts: d.updated_at,
        icon: Trophy,
        iconClass: "text-yellow-500",
        title: `Won: ${d.name}`,
        detail: d.amount ? formatMoneyFromUnits(d.amount) : undefined,
      });
    });
    (payouts ?? []).forEach((p) => {
      out.push({
        id: `payout-${p.id}`,
        ts: p.paid_at ?? p.approved_at ?? p.created_at,
        icon: Banknote,
        iconClass: "text-primary",
        title:
          p.status === "paid"
            ? `Payout paid`
            : p.status === "approved"
              ? `Payout approved`
              : `Payout pending`,
        detail: formatMoneyFromCents(p.amount_cents),
      });
    });
    (bookings ?? []).forEach((b) => {
      out.push({
        id: `booking-${b.id}`,
        ts: b.created_at,
        icon: CalendarCheck,
        iconClass: "text-primary",
        title:
          b.status === "completed"
            ? "Booking completed"
            : b.status === "canceled" || b.status === "no_show"
              ? "Booking canceled"
              : "Booking scheduled",
        detail: new Date(b.scheduled_for).toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    });
    (notifs ?? []).forEach((n) => {
      if (n.type === "comment_on_post") {
        const p = n.payload as { post_title?: string };
        out.push({
          id: `notif-${n.id}`,
          ts: n.created_at,
          icon: MessageSquare,
          iconClass: "text-primary",
          title: "New community reply",
          detail: p?.post_title ? `on "${p.post_title}"` : undefined,
        });
      } else if (n.type === "lead_assigned") {
        const p = n.payload as { first_name?: string; last_name?: string };
        out.push({
          id: `notif-${n.id}`,
          ts: n.created_at,
          icon: UserPlus,
          iconClass: "text-primary",
          title: "New lead assigned",
          detail: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim(),
        });
      }
    });
    return out
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 12);
  }, [wonDeals, payouts, bookings, notifs]);

  if (events.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Your activity
          </h2>
        </div>
        <ol className="space-y-2">
          {events.map((e) => {
            const Icon = e.icon;
            return (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <Icon className={`w-4 h-4 mt-0.5 ${e.iconClass}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{e.title}</p>
                  {e.detail ? (
                    <p className="text-xs text-muted-foreground truncate">
                      {e.detail}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatRelative(e.ts)}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
};

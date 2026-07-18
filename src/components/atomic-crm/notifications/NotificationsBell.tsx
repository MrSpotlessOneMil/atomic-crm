import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellDot } from "lucide-react";
import { useDataProvider, useGetList } from "ra-core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { Notification } from "../types";

const formatRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const describe = (n: Notification): { text: string; to: string } => {
  const p = n.payload as Record<string, unknown>;
  switch (n.type) {
    case "comment_on_post":
      return {
        text: `New comment on "${String(p.post_title ?? "your post")}"`,
        to: "/community",
      };
    case "lead_assigned":
      return {
        text: `New lead: ${String(p.first_name ?? "")} ${String(p.last_name ?? "")}`.trim(),
        to: `/contacts/${String(p.contact_id ?? "")}`,
      };
    case "payout_approved":
      return {
        text: "A payout was approved",
        to: "/payouts",
      };
    case "payout_paid":
      return {
        text: "A payout was marked paid",
        to: "/payouts",
      };
    case "call_due":
      return {
        text: `Call now: double dial${p.step ? ` ${String(p.step)}` : ""} due${p.phone ? ` — ${String(p.phone)}` : ""}`,
        to: `/contacts/${String(p.contact_id ?? "")}/show`,
      };
    case "agent_handoff":
      return {
        text: `Lead handed to you: ${String(p.summary ?? p.reason ?? "check the deal")}`,
        to: `/contacts/${String(p.contact_id ?? "")}/show`,
      };
    case "lead_replied":
      return {
        text: `Lead replied by ${String(p.channel ?? "message")} — respond within 5 min${p.preview ? `: "${String(p.preview).slice(0, 60)}"` : ""}`,
        to: `/contacts/${String(p.contact_id ?? "")}/show`,
      };
    default:
      return { text: "Notification", to: "/" };
  }
};

export const NotificationsBell = () => {
  const dataProvider = useDataProvider();
  const queryClient = useQueryClient();
  const { data: items } = useGetList<Notification>(
    "notifications",
    {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "created_at", order: "DESC" },
    },
    { refetchInterval: 60_000 },
  );
  const list = items ?? [];
  const unread = list.filter((n) => !n.read_at).length;

  const { mutate: markAllRead } = useMutation({
    mutationFn: async () => {
      const unreadIds = list.filter((n) => !n.read_at).map((n) => n.id);
      if (unreadIds.length === 0) return;
      const now = new Date().toISOString();
      await Promise.all(
        unreadIds.map((id) =>
          dataProvider.update("notifications", {
            id,
            data: { read_at: now },
            previousData: list.find((n) => n.id === id),
          }),
        ),
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          {unread > 0 ? (
            <BellDot className="w-5 h-5" />
          ) : (
            <Bell className="w-5 h-5" />
          )}
          {unread > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {list.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            You're all caught up.
          </div>
        ) : (
          list.map((n) => {
            const d = describe(n);
            return (
              <DropdownMenuItem key={n.id} asChild>
                <Link
                  to={d.to}
                  className="flex flex-col items-start gap-1 py-2"
                >
                  <span className="text-sm">{d.text}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelative(n.created_at)}
                  </span>
                </Link>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

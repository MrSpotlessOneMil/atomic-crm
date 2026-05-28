import { Inbox, MoveRight } from "lucide-react";
import { useGetIdentity, useGetList } from "ra-core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import type { Contact } from "../types";

/**
 * Admin-only widget showing the count of unassigned leads.
 * Shown to non-admins as a no-op (renders nothing) — RLS would hide them anyway.
 */
export const UnassignedLeadsWidget = () => {
  const { identity } = useGetIdentity();
  const isAdmin = !!(identity as { administrator?: boolean })?.administrator;

  const { total } = useGetList<Contact>(
    "contacts",
    {
      pagination: { page: 1, perPage: 1 },
      filter: { "sales_id@is": null },
    },
    { enabled: isAdmin },
  );

  if (!isAdmin) return null;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Unassigned leads
          </h2>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-3xl font-semibold">{total ?? 0}</p>
          <Button asChild size="sm" variant="outline">
            <Link
              to={{
                pathname: "/contacts",
                search: `?filter=${encodeURIComponent(
                  JSON.stringify({ "sales_id@is": null }),
                )}`,
              }}
            >
              Route
              <MoveRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

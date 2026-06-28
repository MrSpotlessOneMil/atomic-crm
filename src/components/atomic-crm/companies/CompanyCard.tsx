import { Handshake, PhoneCall } from "lucide-react";
import { Link } from "react-router";
import {
  useCreatePath,
  useGetIdentity,
  useGetOne,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company, Sale } from "../types";
import { CompanyAvatar } from "./CompanyAvatar";
import { formatRelativeDate } from "../misc/RelativeDate";

export const CompanyCard = (props: { record?: Company }) => {
  const createPath = useCreatePath();
  const record = useRecordContext<Company>(props);
  const translate = useTranslate();
  const { companySectors } = useConfigurationContext();
  const { identity } = useGetIdentity();
  if (!record) return null;

  const sector = companySectors.find((s) => s.value === record.sector);
  const sectorLabel = sector?.label;

  // Logging a call claims the lead to the rep who made it, so "owned by me"
  // is our at-a-glance "I already worked this one" signal on the list.
  const isMine =
    record.sales_id != null &&
    identity?.id != null &&
    String(record.sales_id) === String(identity.id);

  // Whether this lead has any logged calls (by anyone) — surfaced even on
  // unclaimed leads so worked leads never look untouched on the list.
  const wasCalled = (record.nb_calls ?? 0) > 0;
  const lastTouch = record.last_contacted_at
    ? formatRelativeDate(record.last_contacted_at)
    : null;

  return (
    <Link
      to={createPath({
        resource: "companies",
        id: record.id,
        type: "show",
      })}
      className="no-underline"
    >
      <Card
        className={cn(
          "h-[200px] flex flex-col justify-between p-4 hover:bg-muted",
          isMine &&
            "bg-green-50/60 ring-1 ring-green-200 hover:bg-green-50 dark:bg-green-950/30 dark:ring-green-900",
          !isMine &&
            wasCalled &&
            "ring-1 ring-border bg-muted/30",
        )}
      >
        <div className="flex flex-col items-center gap-1">
          <CompanyAvatar />
          <div className="text-center mt-1">
            <h6 className="text-sm font-medium">{record.name}</h6>
            <p className="text-xs text-muted-foreground">{sectorLabel}</p>
          </div>
        </div>
        <div className="flex flex-row w-full justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {isMine ? (
              <span className="flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                <PhoneCall className="w-3 h-3" />
                Called{lastTouch ? ` · ${lastTouch}` : ""}
              </span>
            ) : wasCalled ? (
              <span
                title={lastTouch ? `Last contacted ${lastTouch}` : "Called"}
                className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                <PhoneCall className="w-3 h-3" />
                Called{lastTouch ? ` · ${lastTouch}` : ""}
              </span>
            ) : (
              <SalesOwnerBadge salesId={record.sales_id} />
            )}
          </div>
          {record.nb_deals ? (
            <div className="flex items-center ml-2 gap-0.5">
              <Handshake className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{record.nb_deals}</span>
              <span className="text-xs text-muted-foreground">
                {translate("resources.deals.name", {
                  smart_count: record.nb_deals ?? 0,
                  _: "Deal |||| Deals",
                })}
              </span>
            </div>
          ) : null}
        </div>
      </Card>
    </Link>
  );
};

// Who's working this lead — shows the claiming rep's initials (D, JR…), or
// nothing if the lead is still an unclaimed pool lead.
const SalesOwnerBadge = ({ salesId }: { salesId?: number | string }) => {
  const { data: sale } = useGetOne<Sale>(
    "sales",
    { id: salesId as any },
    { enabled: !!salesId },
  );
  if (!salesId || !sale) return null;
  const initials =
    `${sale.first_name?.[0] ?? ""}${sale.last_name?.[0] ?? ""}`.toUpperCase() ||
    "?";
  return (
    <span
      title={`${sale.first_name} ${sale.last_name}`}
      className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold"
    >
      {initials}
    </span>
  );
};

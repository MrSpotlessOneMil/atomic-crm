import { PhoneCall } from "lucide-react";
import { useGetList } from "ra-core";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { formatRelativeDate } from "../misc/RelativeDate";
import type { Company, Contact, ContactNote, Sale } from "../types";

type Range = "week" | "month" | "all";

// A logged call is a contact note whose text starts with the phone marker
// written by the Log Call button ("📞 … called").
const isCallNote = (text?: string | null): boolean =>
  typeof text === "string" && text.trimStart().startsWith("📞");

// Reduce a call note to just its outcome: drop the leading 📞 marker and any
// baked-in "<rep name> called —" prefix, since we show the caller separately.
const callOutcome = (text: string): string => {
  const stripped = text.replace(/^\s*📞\s*/, "").trim();
  const withoutCaller = stripped.replace(/^.*?\bcalled\b\s*[—\-:]*\s*/i, "");
  return withoutCaller.trim();
};

const startOfRange = (range: Range): Date | null => {
  if (range === "all") return null;
  const now = new Date();
  if (range === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
};

export const AllCallsPage = () => {
  const [range, setRange] = useState<Range>("week");
  const [repFilter, setRepFilter] = useState<number | "all">("all");

  const { data: notes, isPending: notesLoading } = useGetList<ContactNote>(
    "contact_notes",
    {
      pagination: { page: 1, perPage: 5000 },
      sort: { field: "date", order: "DESC" },
    },
  );

  const { data: sales, isPending: salesLoading } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "id", order: "ASC" },
  });

  const { data: contacts } = useGetList<Contact>("contacts", {
    pagination: { page: 1, perPage: 5000 },
    sort: { field: "id", order: "ASC" },
  });

  const { data: companies } = useGetList<Company>("companies", {
    pagination: { page: 1, perPage: 5000 },
    sort: { field: "id", order: "ASC" },
  });

  const salesById = useMemo(() => {
    const m = new Map<number | string, Sale>();
    (sales ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [sales]);

  const contactsById = useMemo(() => {
    const m = new Map<number | string, Contact>();
    (contacts ?? []).forEach((c) => m.set(c.id, c));
    return m;
  }, [contacts]);

  const companiesById = useMemo(() => {
    const m = new Map<number | string, Company>();
    (companies ?? []).forEach((c) => m.set(c.id, c));
    return m;
  }, [companies]);

  // The roster used by the rep filter — everyone who shows on the board.
  const roster = useMemo(
    () => (sales ?? []).filter((s) => !s.disabled),
    [sales],
  );

  const calls = useMemo(() => {
    const cutoff = startOfRange(range);
    return (notes ?? [])
      .filter((n) => isCallNote(n.text))
      .filter((n) => (cutoff ? new Date(n.date) >= cutoff : true))
      .filter((n) => (repFilter === "all" ? true : n.sales_id === repFilter));
  }, [notes, range, repFilter]);

  const isPending = notesLoading || salesLoading;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <header className="flex items-center gap-3">
        <PhoneCall className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">All calls</h1>
          <p className="text-sm text-muted-foreground">
            Every call logged across the team — newest first.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            <TabsTrigger value="week">This week</TabsTrigger>
            <TabsTrigger value="month">This month</TabsTrigger>
            <TabsTrigger value="all">All time</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-sm text-muted-foreground">
          {calls.length} {calls.length === 1 ? "call" : "calls"}
        </span>
      </div>

      {/* Rep filter chips — quick way to see one rep's calls or the whole team. */}
      <div className="flex flex-wrap gap-2">
        <RepChip
          label="Everyone"
          active={repFilter === "all"}
          onClick={() => setRepFilter("all")}
        />
        {roster.map((s) => (
          <RepChip
            key={s.id}
            label={`${s.first_name} ${s.last_name ?? ""}`.trim()}
            active={repFilter === s.id}
            onClick={() => setRepFilter(s.id as number)}
          />
        ))}
      </div>

      {isPending ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : calls.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No calls logged in this window yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ol className="divide-y">
              {calls.map((note) => {
                const rep = note.sales_id
                  ? salesById.get(note.sales_id)
                  : undefined;
                const contact = contactsById.get(note.contact_id);
                const company = contact?.company_id
                  ? companiesById.get(contact.company_id)
                  : undefined;
                const who =
                  company?.name ??
                  (contact
                    ? `${contact.first_name} ${contact.last_name ?? ""}`.trim()
                    : "Unknown lead");
                const callerName = rep ? rep.first_name : "Someone";
                const outcome = callOutcome(note.text);
                return (
                  <li
                    key={note.id}
                    className="flex items-start gap-3 px-5 py-4"
                  >
                    <Avatar className="w-8 h-8 mt-0.5">
                      <AvatarImage src={rep?.avatar?.src} />
                      <AvatarFallback>
                        {(rep?.first_name?.[0] ?? "") +
                          (rep?.last_name?.[0] ?? "")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        {/* Who made the call — the bold, unmissable indicator. */}
                        <span className="font-semibold text-primary">
                          {callerName}
                        </span>{" "}
                        <span className="text-muted-foreground">called</span>{" "}
                        {contact ? (
                          <Link
                            to={`/contacts/${contact.id}/show`}
                            className="font-medium hover:underline"
                          >
                            {who}
                          </Link>
                        ) : (
                          <span className="font-medium">{who}</span>
                        )}
                      </p>
                      {outcome ? (
                        <p className="text-sm text-muted-foreground truncate">
                          {outcome}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatRelativeDate(note.date)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

AllCallsPage.path = "/calls";

const RepChip = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <Button
    type="button"
    size="sm"
    variant={active ? "default" : "outline"}
    className="rounded-full h-8"
    onClick={onClick}
  >
    {label}
  </Button>
);

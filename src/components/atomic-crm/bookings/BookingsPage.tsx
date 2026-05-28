import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarCheck, CheckCircle2, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type {
  Booking,
  BookingStatus,
  Contact,
  RepAvailability,
} from "../types";

const STATUS_VARIANT: Record<
  BookingStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  scheduled: "default",
  completed: "outline",
  canceled: "destructive",
  no_show: "destructive",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const BookingsPage = () => {
  const { identity } = useGetIdentity();
  const isAdmin = !!(identity as { administrator?: boolean })?.administrator;

  const { data: bookings, isPending } = useGetList<Booking>("bookings", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "scheduled_for", order: "ASC" },
  });

  const { data: availability } = useGetList<RepAvailability>(
    "rep_availability",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "day_of_week", order: "ASC" },
      filter: identity?.id ? { sales_id: identity.id } : undefined,
    },
    { enabled: !!identity?.id },
  );

  const contactIds = Array.from(
    new Set(
      (bookings ?? [])
        .map((b) => b.contact_id)
        .filter((id): id is number | string => id != null),
    ),
  );
  const { data: contacts } = useGetMany<Contact>(
    "contacts",
    { ids: contactIds },
    { enabled: contactIds.length > 0 },
  );
  const contactById = new Map(
    (contacts ?? []).map((c) => [String(c.id), c]),
  );

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <header className="flex items-center gap-3">
        <CalendarCheck className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Bookings across the team. Mark completed or cancel."
              : "Slots booked through your /u/ profile page."}
          </p>
        </div>
      </header>

      <AvailabilityEditor availability={availability ?? []} />

      <Card>
        <CardContent className="p-0">
          {isPending ? (
            <div className="py-10 text-center text-muted-foreground">
              Loading…
            </div>
          ) : !bookings || bookings.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              No bookings yet. Share your /u/{String(identity?.id ?? "")} link
              to get the first one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Prospect</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b) => {
                  const contact = b.contact_id
                    ? contactById.get(String(b.contact_id))
                    : undefined;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        {formatWhen(b.scheduled_for)}
                      </TableCell>
                      <TableCell>{b.duration_minutes}m</TableCell>
                      <TableCell>
                        {contact
                          ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim()
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {b.notes ?? ""}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[b.status]}>
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <BookingActions booking={b} />
                      </TableCell>
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

BookingsPage.path = "/bookings";

const BookingActions = ({ booking }: { booking: Booking }) => {
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const queryClient = useQueryClient();

  const update = (status: BookingStatus) =>
    dataProvider
      .update("bookings", {
        id: booking.id,
        data: { status },
        previousData: booking,
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["bookings"] });
        notify("crm.bookings.updated", {
          messageArgs: { _: "Booking updated" },
        });
      })
      .catch(() =>
        notify("crm.bookings.update_failed", {
          type: "error",
          messageArgs: { _: "Update failed" },
        }),
      );

  if (booking.status !== "scheduled") return null;

  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" onClick={() => update("completed")}>
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Done
      </Button>
      <Button size="sm" variant="ghost" onClick={() => update("canceled")}>
        <X className="w-3 h-3 mr-1" />
        Cancel
      </Button>
    </div>
  );
};

const AvailabilityEditor = ({
  availability,
}: {
  availability: RepAvailability[];
}) => {
  const { identity } = useGetIdentity();
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    day_of_week: 1,
    start_time: "09:00",
    end_time: "17:00",
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["rep_availability"] });

  const { mutate: add, isPending: adding } = useMutation({
    mutationFn: () =>
      dataProvider.create("rep_availability", {
        data: {
          sales_id: identity?.id,
          day_of_week: draft.day_of_week,
          start_time: `${draft.start_time}:00`,
          end_time: `${draft.end_time}:00`,
        },
      }),
    onSuccess: () => {
      refresh();
      notify("crm.bookings.availability.added", {
        messageArgs: { _: "Window added" },
      });
    },
    onError: () =>
      notify("crm.bookings.availability.error", {
        type: "error",
        messageArgs: { _: "Could not add window" },
      }),
  });

  const { mutate: remove } = useMutation({
    mutationFn: (id: number | string) =>
      dataProvider.delete("rep_availability", {
        id,
        previousData: availability.find((a) => a.id === id),
      }),
    onSuccess: () => refresh(),
  });

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div>
          <h2 className="text-lg font-semibold">Your weekly availability</h2>
          <p className="text-sm text-muted-foreground">
            Prospects can book any 30-minute slot inside these windows on your
            /u/ page.
          </p>
        </div>

        {availability.length > 0 ? (
          <ul className="space-y-1">
            {availability.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between text-sm border rounded-md px-3 py-2"
              >
                <span>
                  <strong className="mr-2">
                    {DAY_LABELS[w.day_of_week] ?? "?"}
                  </strong>
                  {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)} UTC
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(w.id)}
                  aria-label="Remove"
                >
                  <X className="w-3 h-3" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No windows yet. Add one below.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3 pt-2 border-t">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Day
            </label>
            <Select
              value={String(draft.day_of_week)}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, day_of_week: Number(v) }))
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_LABELS.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Start (UTC)
            </label>
            <input
              type="time"
              value={draft.start_time}
              onChange={(e) =>
                setDraft((d) => ({ ...d, start_time: e.target.value }))
              }
              className="border rounded-md px-2 py-1 text-sm bg-background"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              End (UTC)
            </label>
            <input
              type="time"
              value={draft.end_time}
              onChange={(e) =>
                setDraft((d) => ({ ...d, end_time: e.target.value }))
              }
              className="border rounded-md px-2 py-1 text-sm bg-background"
            />
          </div>
          <Button onClick={() => add()} disabled={adding}>
            Add window
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

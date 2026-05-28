import { useMutation } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FUNCTION_URL =
  import.meta.env.VITE_SUPABASE_URL + "/functions/v1/book_slot";
const PUBLISHABLE_KEY = import.meta.env.VITE_SB_PUBLISHABLE_KEY;

export type AvailabilityWindow = {
  day_of_week: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

type SlotOption = {
  iso: string;
  label: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parseClock = (clock: string): { h: number; m: number } => {
  const [h, m] = clock.split(":").map((n) => Number(n));
  return { h: h ?? 0, m: m ?? 0 };
};

/**
 * Build 30-minute slot options for the next 14 days that fall inside any of
 * the rep's availability windows. Returns local-time options (the form
 * submits the iso string back to the server which compares in UTC against
 * the time-of-day windows).
 */
const buildSlots = (windows: AvailabilityWindow[]): SlotOption[] => {
  if (!windows || windows.length === 0) return [];
  const out: SlotOption[] = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);
    // The server compares against UTC day-of-week; mirror that here.
    const dow = new Date(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
    ).getUTCDay();
    const dayWindows = windows.filter((w) => w.day_of_week === dow);
    for (const w of dayWindows) {
      const start = parseClock(w.start_time);
      const end = parseClock(w.end_time);
      for (let h = start.h; h < end.h; h++) {
        for (const m of [0, 30]) {
          if (h === start.h && m < start.m) continue;
          if (h === end.h - 1 && m + 30 > 60 && end.m === 0) continue;
          const slot = new Date(day);
          slot.setUTCHours(h, m, 0, 0);
          if (slot.getTime() < Date.now() + 60 * 60_000) continue; // 1h lead time
          out.push({
            iso: slot.toISOString(),
            label: `${DAY_LABELS[slot.getDay()]} ${slot.toLocaleDateString(
              undefined,
              { month: "short", day: "numeric" },
            )} · ${slot.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}`,
          });
        }
      }
    }
  }
  return out.slice(0, 60);
};

export const BookingWidget = ({
  salesId,
  availability,
  repFirstName,
}: {
  salesId: number;
  availability: AvailabilityWindow[];
  repFirstName: string;
}) => {
  const slots = useMemo(() => buildSlots(availability), [availability]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(
    slots[0]?.iso ?? null,
  );
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    notes: "",
    website: "", // honeypot
  });
  const [done, setDone] = useState<{ at: string } | null>(null);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Pick a time first");
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(PUBLISHABLE_KEY ? { apikey: PUBLISHABLE_KEY } : {}),
        },
        body: JSON.stringify({
          sales_id: salesId,
          scheduled_for: selectedSlot,
          duration_minutes: 30,
          ...form,
        }),
      });
      if (!res.ok) {
        let detail = "Booking failed";
        try {
          const j = await res.json();
          detail = j?.error ?? j?.message ?? detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }
      return (await res.json()) as { scheduled_for: string };
    },
    onSuccess: (data) => setDone({ at: data.scheduled_for }),
  });

  if (slots.length === 0) {
    return null;
  }

  if (done) {
    const when = new Date(done.at).toLocaleString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
          <h3 className="text-xl font-semibold">You're booked.</h3>
          <p className="text-muted-foreground">
            See you on <strong>{when}</strong>. {repFirstName} will reach out
            to confirm.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">
            Pick a time with {repFirstName}
          </h3>
        </div>

        <div>
          <Label className="text-sm">Available slots</Label>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {slots.map((s) => (
              <Button
                key={s.iso}
                type="button"
                variant={selectedSlot === s.iso ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedSlot(s.iso)}
                className="text-xs justify-start"
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isPending) mutate();
          }}
        >
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            className="absolute left-[-9999px] top-[-9999px]"
            aria-hidden="true"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="book-first">First name</Label>
              <Input
                id="book-first"
                required
                value={form.first_name}
                onChange={(e) =>
                  setForm({ ...form, first_name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="book-last">Last name</Label>
              <Input
                id="book-last"
                required
                value={form.last_name}
                onChange={(e) =>
                  setForm({ ...form, last_name: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="book-email">Email</Label>
              <Input
                id="book-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="book-phone">Phone (optional)</Label>
              <Input
                id="book-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="book-notes">Anything we should know?</Label>
            <Textarea
              id="book-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Size of the place, what cleaning service, special asks…"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive">
              {(error as Error).message}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!selectedSlot || isPending}
          >
            {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Book this time
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

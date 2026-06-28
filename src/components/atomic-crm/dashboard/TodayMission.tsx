import { BookOpen, MapPin, Target, Trophy } from "lucide-react";
import { useGetIdentity, useGetList } from "ra-core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Deal } from "../types";

const checklist = [
  "Pounce on every fresh lead within minutes",
  "Answer all social DMs",
  "Clear today's follow-ups",
  "60–65 cold calls (peak windows)",
  "Send tomorrow's confirmations",
  "Log every touch",
];

const WEEKLY_GOAL = 8;

export const TodayMission = () => {
  const { identity } = useGetIdentity();

  // "Your number" — demos this rep has booked/showed/won.
  const { total } = useGetList<Deal>(
    "deals",
    {
      pagination: { page: 1, perPage: 1 },
      filter: identity?.id
        ? { sales_id: identity.id, "stage@in": "(demo-booked,demo-done,won)" }
        : {},
    },
    { enabled: !!identity?.id },
  );
  const booked = total ?? 0;
  const pct = Math.min(100, Math.round((booked / WEEKLY_GOAL) * 100));

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          {/* Number */}
          <div className="lg:w-64 shrink-0 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Target className="w-4 h-4" />
              Today's Mission
            </div>
            <p className="text-sm text-muted-foreground">
              Book qualified demo calls with cleaning-company owners.
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-primary">{booked}</span>
              <span className="text-muted-foreground">/ {WEEKLY_GOAL} demos</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Checklist */}
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Daily non-negotiables
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {checklist.map((c) => (
                <li
                  key={c}
                  className="text-sm text-muted-foreground flex gap-2 items-start"
                >
                  <span>☐</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {/* Quick actions */}
          <div className="flex flex-row lg:flex-col gap-2 lg:w-44 shrink-0">
            <Button asChild variant="default" size="sm" className="flex-1">
              <Link to="/companies">
                <MapPin className="w-4 h-4 mr-2" />
                My leads
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="flex-1">
              <Link to="/resources">
                <BookOpen className="w-4 h-4 mr-2" />
                Playbook
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="flex-1">
              <Link to="/leaderboard">
                <Trophy className="w-4 h-4 mr-2" />
                Leaderboard
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

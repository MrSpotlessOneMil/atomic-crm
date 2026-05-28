import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Trophy } from "lucide-react";
import { Link, useParams } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { LeadCaptureForm } from "./LeadCaptureForm";

const FUNCTION_BASE =
  import.meta.env.VITE_SUPABASE_URL + "/functions/v1/rep_profile";
const PUBLISHABLE_KEY = import.meta.env.VITE_SB_PUBLISHABLE_KEY;

type Profile = {
  id: number;
  first_name: string;
  last_name: string;
  avatar?: { src?: string } | null;
  wonCount: number;
  wonAmount: number;
  streak: number;
  badges: string[];
};

const fetchProfile = async (id: string): Promise<Profile> => {
  const res = await fetch(`${FUNCTION_BASE}/${encodeURIComponent(id)}`, {
    headers: PUBLISHABLE_KEY ? { apikey: PUBLISHABLE_KEY } : undefined,
  });
  if (!res.ok) throw new Error("not found");
  return res.json();
};

const formatMoney = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents);

export const RepProfilePage = () => {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, error } = useQuery({
    queryKey: ["rep_profile", id],
    queryFn: () => fetchProfile(id ?? ""),
    enabled: !!id,
    retry: false,
  });

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-semibold">Rep not found</h1>
        <p className="text-muted-foreground">
          This page may have moved. Visit the main OSIRIS site to get started.
        </p>
        <Button asChild>
          <Link to="/about-osiris">Visit OSIRIS</Link>
        </Button>
      </div>
    );
  }

  const fullName = `${data.first_name} ${data.last_name}`;
  const initials = `${data.first_name?.[0] ?? ""}${data.last_name?.[0] ?? ""}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <Link to="/about-osiris" className="text-lg font-semibold">
          OSIRIS
        </Link>
        <Button asChild variant="ghost">
          <Link to="/login">Sign in</Link>
        </Button>
      </header>

      <section className="px-6 py-16 border-b">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <Avatar className="w-24 h-24 mx-auto">
            <AvatarImage src={data.avatar?.src} />
            <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm uppercase tracking-widest text-muted-foreground">
              OSIRIS sales rep
            </p>
            <h1 className="text-4xl font-bold tracking-tight mt-1">
              {fullName}
            </h1>
          </div>
          <div className="flex items-center justify-center gap-6">
            <Stat
              icon={<Trophy className="w-4 h-4 text-primary" />}
              label="Wins"
              value={String(data.wonCount)}
            />
            <Stat
              icon={<span className="text-primary">$</span>}
              label="Closed"
              value={formatMoney(data.wonAmount)}
            />
            {data.streak >= 2 ? (
              <Stat
                icon={<Flame className="w-4 h-4 text-orange-500" />}
                label="Streak"
                value={`${data.streak}w`}
              />
            ) : null}
          </div>
          {data.badges.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {data.badges.map((b) => (
                <Badge key={b} variant="secondary">
                  {b}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="px-6 py-16 border-b bg-muted/30">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-semibold">
              Hire {data.first_name} for a clean
            </h2>
            <p className="text-muted-foreground">
              Send a request and {data.first_name} will get back to you with a
              quote.
            </p>
          </div>
          <LeadCaptureForm referredBySalesId={data.id} />
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <Card>
            <CardContent className="py-10 space-y-4">
              <h2 className="text-2xl font-semibold">
                Want to sell with {data.first_name}?
              </h2>
              <p className="text-muted-foreground">
                Join the OSIRIS sales team. It's free to start.
              </p>
              <Button asChild size="lg">
                <Link to="/sign-up">
                  Sign up
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
        OSIRIS — powered by Spotless Scrubbers.
      </footer>
    </div>
  );
};

RepProfilePage.path = "/u/:id";

const Stat = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div className="flex flex-col items-center gap-1">
    <div className="flex items-center gap-2 text-sm font-medium">
      {icon}
      <span>{value}</span>
    </div>
    <p className="text-xs uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
  </div>
);

import {
  ArrowRight,
  Bot,
  CalendarCheck,
  CreditCard,
  PhoneCall,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

import { LeadCaptureForm } from "./LeadCaptureForm";

// What Robin Line does for a cleaning company — the product, in plain English.
const howItWorks = [
  {
    icon: PhoneCall,
    title: "Robin answers every lead",
    body: "Our AI voice + text agent replies to every inbound — SMS, phone, web, Meta ads — instantly, 24/7. No lead ever goes unanswered.",
  },
  {
    icon: Sparkles,
    title: "Instant quoting",
    body: "Qualifies the job and gets a consistent price out fast, while the lead is still hot.",
  },
  {
    icon: RouteIcon,
    title: "Dispatch & scheduling",
    body: "Routes every job to the right crew automatically — no more manual scheduling chaos.",
  },
  {
    icon: CreditCard,
    title: "Payments",
    body: "Collects through Stripe so owners stop chasing money.",
  },
  {
    icon: RefreshCw,
    title: "Win-back & reviews",
    body: "Re-engages past customers and pulls reviews on autopilot — repeat revenue owners were leaving on the table.",
  },
  {
    icon: Bot,
    title: "Built on our own CRM",
    body: "Runs on Clean Machine, and plugs into whatever the owner already uses — Housecall Pro, Jobber, ZenMaid, GoHighLevel and more.",
  },
];

// The six places cleaning owners bleed money — the pain you sell against.
const problems = [
  "A lead comes in and nobody answers fast enough — it goes cold or books a competitor.",
  "Quotes take too long and aren't consistent.",
  "Dispatch and scheduling is manual chaos.",
  "Quality control is weak — reviews slip.",
  "Payment collection is slow and leaky.",
  "Past customers never get re-engaged — repeat revenue left on the table.",
];

const liveClients = [
  "West Niagara Cleaning",
  "WinBros",
  "Cedar Rapids House Cleaners",
  "Texas Nova Cleaning",
];

const SignUpButton = ({
  size = "default",
  variant = "default",
}: {
  size?: "default" | "lg";
  variant?: "default" | "secondary";
}) => (
  <Button asChild size={size} variant={variant}>
    <Link to="/sign-up">
      Start selling
      <ArrowRight className="w-4 h-4 ml-2" />
    </Link>
  </Button>
);

export const AboutOsirisPage = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <Link to="/about" className="text-lg font-semibold">
          Robin Line
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <SignUpButton />
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-20 lg:py-28 border-b">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <p className="text-sm uppercase tracking-widest text-muted-foreground">
            Robin Line
          </p>
          <h1 className="text-4xl lg:text-6xl font-bold tracking-tight">
            The AI operating system for cleaning companies.
          </h1>
          <p className="text-lg text-muted-foreground">
            Robin Line answers every lead, quotes, dispatches, collects payment,
            and wins back old customers — automatically. We sell it to house and
            commercial cleaning companies. You book the demos.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <SignUpButton size="lg" />
            <Button asChild size="lg" variant="secondary">
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground italic pt-2">
            "Built by a guy who actually runs a cleaning company — already live
            with companies just like yours."
          </p>
        </div>
      </section>

      {/* The problem */}
      <section className="px-6 py-16 border-b">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-semibold">The problem we solve</h2>
            <p className="text-muted-foreground">
              Cleaning owners bleed money in the same six spots. Robin Line
              plugs every one.
            </p>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {problems.map((p, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-lg border bg-card p-4 text-sm"
              >
                <span className="font-bold text-primary">{i + 1}</span>
                <span className="text-muted-foreground">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-16 border-b bg-muted/30">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-semibold">How Robin Line works</h2>
            <p className="text-muted-foreground">
              The entire front and back office of a cleaning company — running
              itself.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {howItWorks.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-lg border bg-card p-6 flex flex-col gap-3"
                >
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Proof + pricing */}
      <section className="px-6 py-16 border-b">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Real proof, real traction</h2>
            <p className="text-muted-foreground text-sm">
              Robin Line is built by operators, for operators. CEO Dominic owns
              Spotless Scrubbers, a six-figure LA cleaning company — every
              feature got battle-tested on a real operation first.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {liveClients.map((c) => (
                <span
                  key={c}
                  className="text-xs rounded-full border px-3 py-1 text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">
              Less than a VA. More than set hours.
            </h2>
            <p className="text-muted-foreground text-sm">
              A full-time VA costs $1,500–$3,000/mo and still misses leads. Robin
              Line starts at <strong>$599/mo</strong>, runs the back office 24/7,
              and never drops a lead. Your job isn't to negotiate price — it's to
              book the qualified demo and let the team take it from there.
            </p>
          </div>
        </div>
      </section>

      {/* Rep recruitment CTA */}
      <section className="px-6 py-20 border-b bg-muted/30">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <div className="flex justify-center">
            <CalendarCheck className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-3xl lg:text-4xl font-semibold">
            Sell Robin Line. Book demos. Get paid.
          </h2>
          <p className="text-muted-foreground">
            Sign up free, get your mission and your playbook, and start booking
            qualified demo calls with cleaning-company owners. Everything you
            need to sell is in one place.
          </p>
          <div className="flex justify-center">
            <SignUpButton size="lg" />
          </div>
        </div>
      </section>

      {/* Cleaning-company demo request */}
      <section className="px-6 py-16">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-semibold">Run a cleaning company?</h2>
            <p className="text-muted-foreground">
              See Robin in action. Tell us a bit about your operation and we'll
              set up a quick demo — usually within a business day.
            </p>
          </div>
          <LeadCaptureForm />
        </div>
      </section>

      <footer className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
        Robin Line — built by operators, for operators.
      </footer>
    </div>
  );
};

AboutOsirisPage.path = "/about";

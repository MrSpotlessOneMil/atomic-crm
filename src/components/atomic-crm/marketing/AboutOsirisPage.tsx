import {
  ArrowRight,
  Bot,
  Building2,
  CalendarCheck,
  GraduationCap,
  Handshake,
  Home,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

const services = [
  {
    icon: Home,
    title: "Residential cleaning",
    body: "Recurring home cleaning packages homeowners trust. High close rates and dependable repeat revenue.",
  },
  {
    icon: Building2,
    title: "Commercial cleaning",
    body: "Offices, retail, and small commercial accounts. Bigger tickets, longer relationships.",
  },
  {
    icon: CalendarCheck,
    title: "Recurring contracts",
    body: "Weekly, bi-weekly, monthly. We help you turn every one-off into a long-term contract.",
  },
];

const howSteps = [
  {
    icon: UserPlus,
    title: "Sign up",
    body: "Create your free OSIRIS account in under a minute. No sales experience required.",
  },
  {
    icon: GraduationCap,
    title: "Get trained",
    body: "Short, focused lessons on how to source leads, quote jobs, and handle objections.",
  },
  {
    icon: Handshake,
    title: "Close deals & get paid",
    body: "Use the CRM to track contacts and pipeline. Get paid on every signed job and recurring contract.",
  },
];

const reasons = [
  {
    icon: Trophy,
    title: "Gamified leaderboard",
    body: "See how you rank, climb the chart, unlock streaks. Healthy competition keeps you closing.",
  },
  {
    icon: Bot,
    title: "AI sales assistant",
    body: "Draft follow-ups, score leads, and get on-the-fly coaching from an AI built for home services.",
  },
  {
    icon: Wallet,
    title: "Transparent payouts",
    body: "Clear commission structure with no surprises. See your earnings in real time.",
  },
  {
    icon: Users,
    title: "Peer community",
    body: "Swap tactics with other reps. Learn from people closing the same kinds of deals you are.",
  },
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
      Sign up
      <ArrowRight className="w-4 h-4 ml-2" />
    </Link>
  </Button>
);

export const AboutOsirisPage = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <Link to="/about-osiris" className="text-lg font-semibold">
          OSIRIS
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <SignUpButton />
        </div>
      </header>

      <section className="px-6 py-20 lg:py-28 border-b">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <p className="text-sm uppercase tracking-widest text-muted-foreground">
            OSIRIS
          </p>
          <h1 className="text-4xl lg:text-6xl font-bold tracking-tight">
            AI-powered sales for home services.
          </h1>
          <p className="text-lg text-muted-foreground">
            Join a sales platform built for cleaning. Bring in leads, close
            contracts, and get paid — with an AI assistant in your corner the
            whole way.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <SignUpButton size="lg" />
            <Button asChild size="lg" variant="secondary">
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 border-b">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-semibold">What we sell</h2>
            <p className="text-muted-foreground">
              You'll sell three core service lines — all in demand, all
              recurring.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {services.map((service) => {
              const Icon = service.icon;
              return (
                <div
                  key={service.title}
                  className="rounded-lg border bg-card p-6 flex flex-col gap-3"
                >
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{service.title}</h3>
                  <p className="text-sm text-muted-foreground">{service.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-6 py-16 border-b bg-muted/30">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-semibold">How you'll sell with us</h2>
            <p className="text-muted-foreground">
              From zero to your first paycheck in three steps.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {howSteps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="rounded-lg border bg-card p-6 flex flex-col gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-muted-foreground">
                      0{idx + 1}
                    </span>
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-6 py-16 border-b">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-semibold">Why join</h2>
            <p className="text-muted-foreground">
              Coming features we're building so reps win more, faster.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {reasons.map((reason) => {
              const Icon = reason.icon;
              return (
                <div
                  key={reason.title}
                  className="rounded-lg border bg-card p-6 flex flex-col gap-3"
                >
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{reason.title}</h3>
                  <p className="text-sm text-muted-foreground">{reason.body}</p>
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted-foreground italic">
            These features are on the roadmap and being rolled out as OSIRIS
            grows.
          </p>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl lg:text-4xl font-semibold">
            Ready to start closing?
          </h2>
          <p className="text-muted-foreground">
            Sign up for free. Get trained. Start earning.
          </p>
          <div className="flex justify-center">
            <SignUpButton size="lg" />
          </div>
        </div>
      </section>

      <footer className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
        OSIRIS — powered by Spotless Scrubbers.
      </footer>
    </div>
  );
};

AboutOsirisPage.path = "/about-osiris";

import {
  Banknote,
  FileText,
  Flame,
  Gamepad2,
  Phone,
  Rocket,
  Search,
  Sparkles,
  Target,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Downloadable assets live in public/resources and are served as static files.
const COLD_CALL_SCRIPT_URL = "/resources/robin-line-cold-call-script.pdf";

// In-app SDR playbook — your back-pocket knowledge to sell, plus the daily
// plays. Sourced from the Robin Line SDR briefings + robinline.com.

const howItWorks = [
  "Robin (AI agent) answers every lead instantly, 24/7 — SMS, phone, web, Meta ads.",
  "Instant quoting — gets a consistent price out while the lead is hot.",
  "Dispatch & scheduling — routes jobs to the right crew automatically.",
  "Payments — collects through Stripe.",
  "Win-back & reviews — re-engages past customers and pulls reviews on autopilot.",
];

const whoFor = [
  "House + commercial cleaning companies — that's the whole game right now.",
  "The owner / decision-maker who has (or pays for) lead flow.",
  "Chase first: running Meta/Google ads, on GoHighLevel/spreadsheets, or actively hiring cleaners.",
  "Skip / park: not cleaning (→ Expansion bank), dead operation, or no budget.",
];

const waterfall = [
  "Tier 0 — Strike the second it lands: a fresh ad lead or keyword comment? Call within minutes. Intent decays fast.",
  "1. Warm social DMs — followers, profile viewers, likers, keyword commenters off our TikTok / IG.",
  "2. Follow-ups — anyone in your pipeline due for a touch today.",
  "3. Provided lists — batched leads or warm prospect lists.",
  "4. Cold (self-sourced) — nothing warmer left? Scrape your territory off Google Maps and cold-call.",
];

const nonNegotiables = [
  "Pounced on every fresh lead within minutes",
  "All social DMs answered",
  "Follow-ups cleared",
  "60–65 cold calls (peak windows 10–12 & 1–4)",
  "Tomorrow's confirmations sent",
  "Every touch logged in the CRM",
];

const getLeads = [
  'Work your platform daily: inbound DMs first, then everyone who commented / followed / liked (plus TikTok profile viewers), in that order.',
  'Cold outreach: search "Cleaning Company, [your territory]", or open competitor pages (ZenMaid, Booking Koala, Launch27) and DM their followers + commenters. ~30–50 personalized.',
  "Cold calls: pull \"cleaning companies near me\" for your territory off Google Maps and dial.",
  "Why ~30–50 cold DMs, not 100: mass-DMing gets you flagged. Personalized + warm signals carry the volume and convert better.",
];

const qualified = [
  "The owner / decision-maker",
  "An in-vertical cleaning company",
  "Has — or is paying to get — lead flow",
  "Can afford $599+/mo",
  "Has a real admin / ops pain",
];

export const ResourcesPage = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Mission header — game framing */}
      <div className="rounded-xl border bg-gradient-to-br from-primary/10 to-transparent p-6 space-y-2">
        <div className="flex items-center gap-2 text-sm text-primary font-semibold">
          <Gamepad2 className="w-4 h-4" />
          YOUR PLAYBOOK
        </div>
        <h1 className="text-2xl font-bold">
          One job: book qualified demos with cleaning-company owners.
        </h1>
        <p className="text-muted-foreground">
          Hit{" "}
          <strong className="text-foreground">8 booked shows a week</strong>{" "}
          (floor: 5) — that's 2–3 a day. Everything below is the knowledge in
          your back pocket to get there. Read it once, keep it close.
        </p>
      </div>

      <Section icon={Sparkles} title="What is Robin Line?" accent>
        <p className="text-sm text-muted-foreground mb-3">
          <strong className="text-foreground">
            The AI operating system for cleaning companies.
          </strong>{" "}
          It runs the entire front and back office — automatically — so owners
          stop bleeding money and stop drowning in admin.
        </p>
        <ul className="space-y-1.5 list-disc pl-5">
          {howItWorks.map((h, i) => (
            <li key={i} className="text-sm text-muted-foreground">
              {h}
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Users} title="Who you're selling to" accent>
        <ul className="space-y-1.5 list-disc pl-5">
          {whoFor.map((w, i) => (
            <li key={i} className="text-sm text-muted-foreground">
              {w}
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={FileText} title="Cold-call script" accent>
        <p className="text-sm text-muted-foreground mb-3">
          The full Robin Line cold-call script — opener, qualifying questions,
          objection handling, and the close. Keep it open while you dial.
        </p>
        <Button asChild>
          <a href={COLD_CALL_SCRIPT_URL} target="_blank" rel="noopener noreferrer">
            <FileText className="w-4 h-4 mr-2" />
            Open the script (PDF)
          </a>
        </Button>
      </Section>

      <Section icon={Phone} title="Your pitch (say it out loud)">
        <p className="text-sm text-muted-foreground italic mb-2">
          "Built by a guy who actually runs a cleaning company — already live
          with companies just like yours."
        </p>
        <p className="text-sm text-muted-foreground">
          The hook: <strong className="text-foreground">less than a VA,
          better than a VA.</strong> A VA costs $1,500–$3,000/mo and still
          misses leads. Robin Line runs the back office 24/7 and never drops
          one. You don't sell the price — you book the demo.
        </p>
      </Section>

      <Section icon={Target} title="The waterfall — what to do next">
        <ol className="space-y-2">
          {waterfall.map((w, i) => (
            <li key={i} className="text-sm flex gap-2">
              {i === 0 ? (
                <Flame className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
              ) : (
                <span className="text-primary font-semibold">•</span>
              )}
              <span className="text-muted-foreground">{w}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section icon={Search} title="How to get more leads">
        <ul className="space-y-2 list-disc pl-5">
          {getLeads.map((g, i) => (
            <li key={i} className="text-sm text-muted-foreground">
              {g}
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Trophy} title="Daily non-negotiables — before you log off">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {nonNegotiables.map((n, i) => (
            <li
              key={i}
              className="text-sm text-muted-foreground flex gap-2 items-start"
            >
              <span>☐</span>
              {n}
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Rocket} title="What counts as a qualified meeting">
        <ul className="space-y-1.5 list-disc pl-5">
          {qualified.map((q, i) => (
            <li key={i} className="text-sm text-muted-foreground">
              {q}
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Banknote} title="How you get paid" accent>
        <p className="text-sm text-muted-foreground mb-3">
          Pure commission — you eat what you kill. Paid for meetings that{" "}
          <strong className="text-foreground">actually show</strong> and
          customers who <strong className="text-foreground">actually stay</strong>.
          Payouts are sent via <strong className="text-foreground">Zelle</strong>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Tier name="Per qualified show" price="$15" sub="in-ICP + actually shows" />
          <Tier name="Per closed customer" price="50%" sub="of their first month" />
          <Tier name="Residual book" price="3% / mo" sub="for 12 months, compounding" />
        </div>
        <div className="mt-3 text-sm text-muted-foreground space-y-1">
          <p>
            <strong className="text-foreground">Accelerators:</strong> past 8
            shows/wk → $25/show · 6+ closes/mo → 60% (not 50%) · #1 on the
            leaderboard → $500 spiff · 3 months at target → AE track + 4%
            residual.
          </p>
          <p>
            <strong className="text-foreground">Targets:</strong> Floor 5/wk ·
            Target 8/wk · Killer 12+/wk. Clawback if a customer churns within 60
            days — win when the customer wins.
          </p>
        </div>
      </Section>

      <Section icon={Wallet} title="Pricing — 'Less than a VA. More than set hours.'">
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Starts at <strong className="text-foreground">$599/mo</strong>, runs
            24/7, never drops a lead — vs a VA at $1,500–$3,000/mo.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <Tier name="Starter" price="$599/mo" sub="$0–$10k/mo revenue" />
            <Tier
              name="Growth"
              price="$1,299/mo"
              sub="$10k–$30k/mo · replaces 1 VA"
            />
            <Tier name="Scale" price="$2,499/mo" sub="$30k+/mo · 2+ VAs" />
          </div>
          <p className="pt-1 italic">
            You don't negotiate price — you book the qualified demo. The number
            and fit happen on the call with the closer.
          </p>
        </div>
      </Section>
    </div>
  );
};

ResourcesPage.path = "/resources";

const Section = ({
  icon: Icon,
  title,
  children,
  accent = false,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) => (
  <Card className={accent ? "border-primary/40" : undefined}>
    <CardContent className="py-5 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </CardContent>
  </Card>
);

const Tier = ({
  name,
  price,
  sub,
}: {
  name: string;
  price: string;
  sub: string;
}) => (
  <div className="rounded-lg border bg-card p-3">
    <p className="text-xs uppercase tracking-wide text-muted-foreground">
      {name}
    </p>
    <p className="text-lg font-bold">{price}</p>
    <p className="text-xs text-muted-foreground">{sub}</p>
  </div>
);

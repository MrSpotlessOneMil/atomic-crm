import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  DollarSign,
  Loader2,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import {
  Form,
  useDataProvider,
  useGetIdentity,
  useGetOne,
  useNotify,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { TextInput } from "@/components/admin/text-input";
import { SelectInput } from "@/components/admin/select-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import ImageEditorField from "../misc/ImageEditorField";
import type { CrmDataProvider } from "../providers/types";
import type { Sale, SalesFormData } from "../types";
import { onboardingStorageKey } from "./useOnboardingRedirect";

type StepDescriptor = {
  id: string;
  label: string;
};

const STEPS: StepDescriptor[] = [
  { id: "welcome", label: "Welcome" },
  { id: "profile", label: "Your profile" },
  { id: "how", label: "How you sell" },
  { id: "ready", label: "Ready" },
];

export const OnboardingPage = () => {
  const { identity, isPending: identityPending } = useGetIdentity();
  const translate = useTranslate();
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [stepIndex, setStepIndex] = useState(0);

  const { data: sale, refetch } = useGetOne<Sale>(
    "sales",
    { id: identity?.id ?? "" },
    { enabled: !!identity?.id },
  );

  if (identityPending || !identity) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const totalSteps = STEPS.length;
  const progressValue = ((stepIndex + 1) / totalSteps) * 100;

  const goNext = () => setStepIndex((s) => Math.min(s + 1, totalSteps - 1));
  const goPrev = () => setStepIndex((s) => Math.max(s - 1, 0));

  const finish = () => {
    if (identity?.id != null) {
      try {
        localStorage.setItem(onboardingStorageKey(identity.id), "true");
      } catch {
        // Storage may be unavailable (private mode). Non-critical.
      }
    }
    // Persist server-side so the flag survives device changes.
    void (
      dataProvider as unknown as {
        markOnboardingCompleted?: () => Promise<void>;
      }
    ).markOnboardingCompleted?.();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between p-6 border-b">
        <Link to="/" className="text-lg font-semibold">
          Robin Line
        </Link>
        <Link
          to="/"
          onClick={finish}
          className="text-sm text-muted-foreground hover:underline"
        >
          {translate("crm.onboarding.skip", { _: "Skip for now" })}
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {translate("crm.onboarding.step_label", {
                _: "Step %{current} of %{total}",
                current: stepIndex + 1,
                total: totalSteps,
              })}
            </span>
            <span>{STEPS[stepIndex].label}</span>
          </div>
          <Progress value={progressValue} />
        </div>

        <Card>
          <CardContent className="py-2">
            {stepIndex === 0 && <WelcomeStep onNext={goNext} />}
            {stepIndex === 1 && (
              <ProfileStep
                sale={sale}
                onNext={() => {
                  refetch();
                  goNext();
                }}
                onBack={goPrev}
              />
            )}
            {stepIndex === 2 && <HowYouSellStep onNext={goNext} onBack={goPrev} />}
            {stepIndex === 3 && (
              <ReadyStep
                onBack={goPrev}
                onFinish={(target) => {
                  finish();
                  navigate(target);
                }}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

OnboardingPage.path = "/onboarding";

const WelcomeStep = ({ onNext }: { onNext: () => void }) => {
  const translate = useTranslate();
  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center gap-3">
        <Sparkles className="w-7 h-7 text-primary" />
        <h2 className="text-2xl font-semibold">
          {translate("crm.onboarding.welcome.title", {
            _: "Welcome to the team. Here's your mission.",
          })}
        </h2>
      </div>
      <p className="text-base text-muted-foreground">
        {translate("crm.onboarding.welcome.body", {
          _: "You sell Robin Line — the AI operating system for cleaning companies. Your one job: book qualified demo calls with cleaning-company owners. The team closes them; you get paid on every demo that shows.",
        })}
      </p>
      <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
        <p className="text-sm font-semibold">Your north star</p>
        <p className="text-3xl font-bold text-primary">8 qualified shows / week</p>
        <p className="text-sm text-muted-foreground">
          A qualified demo is a cleaning-company owner who has (or is paying for)
          lead flow, can afford $599+/mo, and has real admin pain. Book those,
          confirm them so they show, and the leaderboard takes care of itself.
        </p>
      </div>
      <div className="flex justify-end">
        <Button onClick={onNext}>
          {translate("crm.onboarding.next", { _: "Let's go" })}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
};

const ProfileStep = ({
  sale,
  onNext,
  onBack,
}: {
  sale: Sale | undefined;
  onNext: () => void;
  onBack: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate, isPending } = useMutation({
    mutationKey: ["onboarding-profile", sale?.id],
    mutationFn: async (values: Partial<SalesFormData>) => {
      if (!sale) {
        throw new Error("Profile not loaded");
      }
      return dataProvider.salesUpdate(sale.id, {
        first_name: values.first_name ?? sale.first_name,
        last_name: values.last_name ?? sale.last_name,
        email: sale.email,
        administrator: sale.administrator,
        disabled: sale.disabled ?? false,
        avatar: values.avatar,
        platform: values.platform ?? sale.platform,
        territory: values.territory ?? sale.territory,
        quo_phone: values.quo_phone ?? sale.quo_phone,
        sdr_role: values.sdr_role ?? sale.sdr_role ?? "sdr",
      });
    },
    onSuccess: () => {
      notify("crm.onboarding.profile.saved", {
        type: "success",
        messageArgs: { _: "Profile saved" },
      });
      onNext();
    },
    onError: () => {
      notify("crm.onboarding.profile.error", {
        type: "error",
        messageArgs: { _: "Could not save your profile. Please try again." },
      });
    },
  });

  if (!sale) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const handleSubmit = (values: any) => {
    mutate(values);
  };

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">
          {translate("crm.onboarding.profile.title", {
            _: "Your profile",
          })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {translate("crm.onboarding.profile.subtitle", {
            _: "Add a photo and confirm your name. This is how clients and teammates will see you.",
          })}
        </p>
      </div>

      <Form onSubmit={handleSubmit} record={sale}>
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-2">
            <ImageEditorField
              source="avatar"
              type="avatar"
              width={96}
              height={96}
              linkPosition="bottom"
              emptyText={`${sale.first_name?.[0] ?? ""}${sale.last_name?.[0] ?? ""}`}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              source="first_name"
              label="resources.sales.fields.first_name"
              helperText={false}
            />
            <TextInput
              source="last_name"
              label="resources.sales.fields.last_name"
              helperText={false}
            />
          </div>

          <SelectInput
            source="sdr_role"
            label="Your role"
            defaultValue="sdr"
            helperText="Account Executives don't need a territory or platform"
            choices={[
              { id: "sdr", name: "SDR" },
              { id: "ae", name: "Account Executive / Closer" },
            ]}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SelectInput
              source="platform"
              label="Your social platform"
              helperText="The account you're responsible for"
              choices={[
                { id: "instagram", name: "Instagram" },
                { id: "tiktok", name: "TikTok" },
                { id: "facebook", name: "Facebook" },
                { id: "linkedin", name: "LinkedIn" },
                { id: "multiple", name: "Multiple / Cold call only" },
                { id: "none", name: "None" },
              ]}
            />
            <TextInput
              source="territory"
              label="Your territory / location"
              helperText="e.g. Los Angeles, Dallas, Tampa (SDRs)"
            />
          </div>

          <TextInput
            source="quo_phone"
            label="Your Quo phone number"
            helperText="The number we gave you, e.g. +13105551234 — to text leads from here"
          />

          <div className="flex justify-between pt-2">
            <Button type="button" variant="ghost" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {translate("crm.onboarding.back", { _: "Back" })}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {translate("crm.onboarding.save_and_continue", {
                _: "Save & continue",
              })}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
};

const HowYouSellStep = ({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) => {
  const translate = useTranslate();
  const tiles = [
    {
      icon: Target,
      title: translate("crm.onboarding.how.waterfall.title", {
        _: "1. Work warmest → coldest",
      }),
      body: translate("crm.onboarding.how.waterfall.body", {
        _: "Run the waterfall: fresh ad leads & DMs first, then follow-ups due today, then provided lists, then cold calls off Google Maps. Always be on the hottest lead available.",
      }),
    },
    {
      icon: Users,
      title: translate("crm.onboarding.how.qualify.title", {
        _: "2. Qualify in seconds",
      }),
      body: translate("crm.onboarding.how.qualify.body", {
        _: "Owner? Cleaning company? Has or wants lead flow? Can afford $599+? Real admin pain? If yes, it's a real prospect — log it and push for the demo.",
      }),
    },
    {
      icon: CheckCircle2,
      title: translate("crm.onboarding.how.book.title", {
        _: "3. Book the demo",
      }),
      body: translate("crm.onboarding.how.book.body", {
        _: "Your win is a booked, qualified demo. Fire the calendar invite on the spot, log the qualifier answers, and put a closer on it.",
      }),
    },
    {
      icon: DollarSign,
      title: translate("crm.onboarding.how.show.title", {
        _: "4. Make it show",
      }),
      body: translate("crm.onboarding.how.show.body", {
        _: "You're paid on shows, not bookings. Confirm at booking, remind 24h out, text the morning of. A no-show = $0.",
      }),
    },
  ];

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">
          {translate("crm.onboarding.how.title", { _: "How you sell" })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {translate("crm.onboarding.how.subtitle", {
            _: "Warmest to coldest. Book the demo. Make it show.",
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div
              key={tile.title}
              className="rounded-lg border p-4 flex flex-col gap-2 bg-card"
            >
              <Icon className="w-5 h-5 text-primary" />
              <p className="text-sm font-medium">{tile.title}</p>
              <p className="text-sm text-muted-foreground">{tile.body}</p>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between pt-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {translate("crm.onboarding.back", { _: "Back" })}
        </Button>
        <Button onClick={onNext}>
          {translate("crm.onboarding.next", { _: "Next" })}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
};

const ReadyStep = ({
  onBack,
  onFinish,
}: {
  onBack: () => void;
  onFinish: (target: string) => void;
}) => {
  const translate = useTranslate();
  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="w-7 h-7 text-primary" />
        <h2 className="text-2xl font-semibold">
          {translate("crm.onboarding.ready.title", {
            _: "You're ready to roll",
          })}
        </h2>
      </div>
      <p className="text-base text-muted-foreground">
        {translate("crm.onboarding.ready.body", {
          _: "Where do you want to start?",
        })}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button
          variant="default"
          className="h-auto py-4 flex flex-col items-start gap-1"
          onClick={() => onFinish("/contacts/create")}
        >
          <Users className="w-4 h-4" />
          <span className="font-medium">
            {translate("crm.onboarding.ready.add_contact", {
              _: "Add your first lead",
            })}
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex flex-col items-start gap-1"
          onClick={() => onFinish("/payouts")}
        >
          <Banknote className="w-4 h-4" />
          <span className="font-medium">
            {translate("crm.onboarding.ready.payouts", {
              _: "See your payouts",
            })}
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex flex-col items-start gap-1"
          onClick={() => onFinish("/leaderboard")}
        >
          <Trophy className="w-4 h-4" />
          <span className="font-medium">
            {translate("crm.onboarding.ready.leaderboard", {
              _: "View leaderboard",
            })}
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex flex-col items-start gap-1"
          onClick={() => onFinish("/")}
        >
          <Sparkles className="w-4 h-4" />
          <span className="font-medium">
            {translate("crm.onboarding.ready.dashboard", {
              _: "Go to dashboard",
            })}
          </span>
        </Button>
      </div>

      <div className="flex justify-between pt-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {translate("crm.onboarding.back", { _: "Back" })}
        </Button>
      </div>
    </div>
  );
};

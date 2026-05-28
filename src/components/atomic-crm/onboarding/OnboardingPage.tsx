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
          OSIRIS
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
            _: "You're in. Here's what OSIRIS is.",
          })}
        </h2>
      </div>
      <p className="text-base text-muted-foreground">
        {translate("crm.onboarding.welcome.body", {
          _: "OSIRIS is an AI-powered sales platform for home services. You'll get tools, leads, and coaching to help you close cleaning contracts and earn payouts on every win. Let's set up your account.",
        })}
      </p>
      <div className="flex justify-end">
        <Button onClick={onNext}>
          {translate("crm.onboarding.next", { _: "Next" })}
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
      icon: Users,
      title: translate("crm.onboarding.how.lead.title", { _: "1. Find a lead" }),
      body: translate("crm.onboarding.how.lead.body", {
        _: "Reach out to homeowners and businesses, or work the inbound leads OSIRIS sends your way.",
      }),
    },
    {
      icon: Target,
      title: translate("crm.onboarding.how.deal.title", { _: "2. Open a deal" }),
      body: translate("crm.onboarding.how.deal.body", {
        _: "Capture the contact in the CRM and move them through the pipeline: discovery, quote, signed.",
      }),
    },
    {
      icon: DollarSign,
      title: translate("crm.onboarding.how.win.title", { _: "3. Win & get paid" }),
      body: translate("crm.onboarding.how.win.body", {
        _: "Mark the deal won and a payout is queued. Recurring contracts pay every month.",
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
            _: "Three steps from first conversation to payout.",
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              _: "Add your first contact",
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

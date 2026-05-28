import { useMutation } from "@tanstack/react-query";
import { Banknote, Loader2 } from "lucide-react";
import { useGetIdentity, useGetOne, useNotify } from "ra-core";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSupabaseClient } from "../providers/supabase/supabase";

type SaleRow = {
  id: number | string;
  stripe_account_id: string | null;
  stripe_account_status: string | null;
};

export const StripeOnboardingWidget = () => {
  const { identity } = useGetIdentity();
  const notify = useNotify();
  const { data, refetch } = useGetOne<SaleRow>(
    "sales",
    { id: identity?.id ?? "" },
    { enabled: !!identity?.id },
  );

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const { data: resp, error } =
        await getSupabaseClient().functions.invoke<{ url: string }>(
          "stripe_account_onboarding",
          { method: "POST", body: {} },
        );
      if (error || !resp?.url) {
        throw new Error(
          (error as Error | undefined)?.message ||
            "Could not start Stripe onboarding",
        );
      }
      return resp.url;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: Error) => {
      notify(err.message, {
        type: "error",
        messageArgs: { _: err.message },
      });
    },
  });

  if (!identity) return null;
  const status = data?.stripe_account_status;
  const hasAccount = !!data?.stripe_account_id;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <Banknote className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Get paid
          </h2>
        </div>
        {hasAccount && status === "complete" ? (
          <>
            <p className="text-sm">
              Your bank account is connected. Approved payouts hit your
              account automatically.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => mutate()}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              ) : null}
              Update bank details
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {hasAccount
                ? "Finish your Stripe onboarding so you can receive payouts."
                : "Connect a bank account through Stripe to receive your commission payouts."}
            </p>
            <Button
              size="sm"
              onClick={() => mutate()}
              disabled={isPending}
              className="w-full"
            >
              {isPending ? (
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              ) : null}
              {hasAccount ? "Resume Stripe onboarding" : "Connect Stripe"}
            </Button>
          </>
        )}
        {/* useGetOne refetch on cache-bust */}
        <button type="button" hidden onClick={() => refetch()} />
      </CardContent>
    </Card>
  );
};

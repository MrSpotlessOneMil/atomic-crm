import { useGetIdentity } from "ra-core";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

export const ONBOARDING_STORAGE_KEY_PREFIX = "osiris.onboarding_completed_";

export const onboardingStorageKey = (salesId: string | number) =>
  `${ONBOARDING_STORAGE_KEY_PREFIX}${salesId}`;

/**
 * Redirects newly signed-up reps to the onboarding wizard the first time they
 * land in the authenticated app. Prefers the server-side
 * sales.onboarding_completed_at timestamp; falls back to localStorage so
 * existing reps who completed pre-server-flag don't re-see the wizard.
 *
 * Admins are exempted.
 */
export const useOnboardingRedirect = () => {
  const { identity, isPending } = useGetIdentity();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isPending || !identity?.id) return;
    if (location.pathname.startsWith("/onboarding")) return;
    if ((identity as { administrator?: boolean }).administrator) return;

    const serverDone = !!(
      identity as { onboarding_completed_at?: string | null }
    ).onboarding_completed_at;
    if (serverDone) return;

    try {
      const done = localStorage.getItem(onboardingStorageKey(identity.id));
      if (!done) {
        navigate("/onboarding", { replace: true });
      }
    } catch {
      // localStorage may be unavailable. Fail open.
    }
  }, [identity, isPending, location.pathname, navigate]);
};

import { useGetIdentity } from "ra-core";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

export const ONBOARDING_STORAGE_KEY_PREFIX = "osiris.onboarding_completed_";

export const onboardingStorageKey = (salesId: string | number) =>
  `${ONBOARDING_STORAGE_KEY_PREFIX}${salesId}`;

/**
 * Redirects newly signed-up reps to the onboarding wizard the first time they
 * land in the authenticated app. The completion flag is written to
 * localStorage by `OnboardingPage` (both on finish and on skip).
 *
 * Admins are exempted so existing accounts and the initial Spotless admin
 * account never see the wizard.
 */
export const useOnboardingRedirect = () => {
  const { identity, isPending } = useGetIdentity();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isPending || !identity?.id) return;
    if (location.pathname.startsWith("/onboarding")) return;
    if ((identity as { administrator?: boolean }).administrator) return;

    try {
      const done = localStorage.getItem(onboardingStorageKey(identity.id));
      if (!done) {
        navigate("/onboarding", { replace: true });
      }
    } catch {
      // localStorage may be unavailable (private mode, etc.). Fail open.
    }
  }, [identity, isPending, location.pathname, navigate]);
};

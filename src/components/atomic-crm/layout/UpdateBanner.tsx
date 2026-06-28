import { useEffect, useState } from "react";

/**
 * Surfaces a "new version available" banner when a freshly deployed service
 * worker takes control of the page.
 *
 * The PWA caches aggressively (autoUpdate + skipWaiting + clientsClaim in
 * vite.config.ts). On a new deploy the new SW activates in the background, but
 * the already-open app keeps running the OLD JavaScript bundle until it is
 * reloaded. Reps run the installed PWA on their phones and rarely close it, so
 * without a nudge they can sit on a stale build for days — which is why a
 * shipped change (e.g. the Log Call button) "doesn't show up" for them even
 * though it's live. This gives a one-tap reload at a moment they choose, so we
 * never have to walk someone through clearing site data again.
 */
export const UpdateBanner = () => {
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Only treat a controller swap as an *update*. The first controllerchange
    // on a brand-new install (no prior controller) is not an update and must
    // not trigger the banner.
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (hadController) setUpdated(true);
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    // A long-open installed PWA won't reliably re-check for new deploys on its
    // own. Poll the registration so a new build is discovered within a minute
    // even if the app is never closed.
    let interval: ReturnType<typeof setInterval> | undefined;
    navigator.serviceWorker.ready
      .then((reg) => {
        interval = setInterval(() => {
          reg.update().catch(() => {});
        }, 60_000);
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      if (interval) clearInterval(interval);
    };
  }, []);

  if (!updated) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] flex flex-wrap items-center justify-center gap-3 bg-primary px-4 py-3 text-primary-foreground shadow-lg">
      <span className="text-sm font-medium">
        A new version of the app is available.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary-foreground px-3 py-1.5 text-sm font-semibold text-primary hover:opacity-90"
      >
        Refresh
      </button>
    </div>
  );
};

import { useDataProvider, useGetIdentity } from "ra-core";
import { useEffect, useState } from "react";

import type { CrmDataProvider } from "../providers/types";

const KEY = "inbox_last_viewed";

// Mark the inbox as seen up to now (called when the rep opens / leaves the Inbox).
export function markInboxViewed() {
  try {
    localStorage.setItem(KEY, new Date().toISOString());
    window.dispatchEvent(new Event("inbox-viewed"));
  } catch {
    /* ignore */
  }
}

function lastViewed(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v;
  } catch {
    /* ignore */
  }
  // First run: treat everything as already seen so we don't flag the whole list.
  markInboxViewed();
  return new Date().toISOString();
}

// Count conversations whose latest activity is newer than the rep's last visit
// to the Inbox — a lightweight "new replies waiting" badge.
export function useInboxUnread(): number {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { identity } = useGetIdentity();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!identity?.id) return;
    let active = true;

    const check = async () => {
      try {
        const convos = await dataProvider.quoConversations();
        if (!active) return;
        const seen = lastViewed();
        const n = convos.filter(
          (c) => (c.lastActivityAt ?? "") > seen,
        ).length;
        setCount(n);
      } catch {
        if (active) setCount(0);
      }
    };

    check();
    const id = setInterval(check, 90000);
    const onViewed = () => setCount(0);
    window.addEventListener("inbox-viewed", onViewed);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("inbox-viewed", onViewed);
    };
  }, [dataProvider, identity?.id]);

  return count;
}

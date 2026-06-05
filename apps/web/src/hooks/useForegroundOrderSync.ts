import { useCallback, useEffect } from "react";
import { syncOrder } from "../api";

export function useForegroundOrderSync(
  orderId: string | null,
  lastEventId: number,
  applySnapshot: (snapshot: Awaited<ReturnType<typeof syncOrder>>["snapshot"]) => void
) {
  const runSync = useCallback(async () => {
    if (!orderId) return;
    const result = await syncOrder(orderId, lastEventId);
    if (result.snapshot) applySnapshot(result.snapshot);
  }, [orderId, lastEventId, applySnapshot]);

  useEffect(() => {
    if (!orderId) return;

    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    };

    document.addEventListener("visibilitychange", syncWhenVisible);
    window.addEventListener("focus", syncWhenVisible);
    window.addEventListener("online", syncWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", syncWhenVisible);
      window.removeEventListener("focus", syncWhenVisible);
      window.removeEventListener("online", syncWhenVisible);
    };
  }, [orderId, runSync]);

  return runSync;
}


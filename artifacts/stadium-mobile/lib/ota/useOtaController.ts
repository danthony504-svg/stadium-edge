/**
 * Production OTA driver. Mount once from OtaRuntime (after first paint).
 * - boot() with no reload
 * - delayed check once, and only after native startup procedure settles
 * - foreground check with cooldown (never reload)
 * - restart() only when UI calls it
 */

import { useCallback, useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { getOtaController } from "./otaControllerSingleton.ts";
import {
  DEFAULT_LAUNCH_DELAY_MS,
  type OtaSnapshot,
} from "./types.ts";
import { waitForStartupProcedureIdle } from "./waitForStartupProcedureIdle.ts";

export { waitForStartupProcedureIdle } from "./waitForStartupProcedureIdle.ts";

export function useOtaController(enabled: boolean): {
  snapshot: OtaSnapshot;
  restart: () => Promise<"reloaded" | "rejected">;
} {
  const controller = getOtaController();
  const [snapshot, setSnapshot] = useState<OtaSnapshot>(() =>
    controller.getSnapshot(),
  );

  useEffect(() => {
    return controller.subscribe(() => {
      setSnapshot(controller.getSnapshot());
    });
  }, [controller]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    // Boot first — never reload. Then wait for launch delay + startup idle.
    controller.boot();

    const launchTimer = setTimeout(() => {
      void (async () => {
        await waitForStartupProcedureIdle(() => controller.isStartupBlocking());
        if (cancelled) return;
        await controller.check();
      })();
    }, DEFAULT_LAUNCH_DELAY_MS);

    let backgroundAt = 0;
    const onAppState = (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        backgroundAt = Date.now();
        return;
      }
      if (state === "active" && backgroundAt > 0) {
        backgroundAt = 0;
        void controller.onForeground();
      }
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      cancelled = true;
      clearTimeout(launchTimer);
      sub.remove();
    };
  }, [controller, enabled]);

  const restart = useCallback(() => controller.restart(), [controller]);

  return { snapshot, restart };
}

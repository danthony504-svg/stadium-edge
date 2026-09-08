/**
 * Pure OTA check/fetch/reload transaction — no expo-updates / React Native imports
 * so Node tests can exercise the production path without Metro.
 */

import {
  GUARD_WINDOW_MS,
  MAX_AUTO_RELOADS_PER_UPDATE,
  shouldAllowAutoReload,
  type OtaReloadGuard,
} from "./otaReloadGuard.ts";

export type OtaPrefetchOutcome = "applied" | "pending" | "none";

export type OtaUpdateClient = {
  checkForUpdateAsync: () => Promise<{
    isAvailable: boolean;
    isRollBackToEmbedded?: boolean;
    reason?: string;
  }>;
  fetchUpdateAsync: () => Promise<OtaFetchResult | void>;
  reloadAsync: (opts?: { reloadScreenOptions?: { fade?: boolean } }) => Promise<void>;
};

export type OtaFetchResult = {
  isNew?: boolean;
  isRollBackToEmbedded?: boolean;
};

export type OtaLogStep = "checkForUpdateAsync" | "fetchUpdateAsync" | "reloadAsync";
export type OtaLogger = (step: OtaLogStep, ok: boolean, detail: string) => void;

/** In-memory auto-reload loop guard (JS session only). */
let sessionReloadGuard: OtaReloadGuard | null = null;

export function resetOtaUpdaterSessionGuardForTests(): void {
  sessionReloadGuard = null;
}

function allowSessionAutoReload(updateKey: string, now = Date.now()): boolean {
  return shouldAllowAutoReload(sessionReloadGuard, updateKey, now);
}

function recordSessionAutoReload(updateKey: string, now = Date.now()): void {
  if (
    !sessionReloadGuard ||
    sessionReloadGuard.updateId !== updateKey ||
    now - sessionReloadGuard.firstAttemptAt > GUARD_WINDOW_MS
  ) {
    sessionReloadGuard = { updateId: updateKey, attempts: 1, firstAttemptAt: now };
    return;
  }
  sessionReloadGuard = {
    ...sessionReloadGuard,
    attempts: sessionReloadGuard.attempts + 1,
  };
}

function checkDetail(check: {
  isAvailable: boolean;
  isRollBackToEmbedded?: boolean;
  reason?: string;
}): string {
  if (check.isAvailable) return "isAvailable=true";
  if (check.isRollBackToEmbedded) return "rollBackToEmbedded";
  return `isAvailable=false reason=${check.reason ?? "unknown"}`;
}

function fetchDetail(fetched: OtaFetchResult | null | undefined): string {
  if (!fetched) return "success";
  if (fetched.isRollBackToEmbedded) return "rollBackToEmbedded";
  if (fetched.isNew === false) return "isNew=false";
  if (fetched.isNew === true) return "isNew=true";
  return "success";
}

/**
 * Check/fetch always run. Coach/Fantasy/keyboard-style reload blocks only delay reload.
 * A successful fetch after isAvailable is treated as pending immediately (no latestContext wait).
 */
export async function prefetchOtaUpdate(
  client: OtaUpdateClient,
  isPending: () => boolean,
  applyWhenReady = false,
  options?: {
    isReloadBlocked?: () => boolean;
    log?: OtaLogger;
    reloadUpdateKey?: string;
  },
): Promise<OtaPrefetchOutcome> {
  const log: OtaLogger = options?.log ?? (() => {});
  const reloadBlocked = options?.isReloadBlocked ?? (() => false);
  const updateKey = options?.reloadUpdateKey ?? "pending";

  const pendingBefore = isPending();
  let fetchedPending = false;

  try {
    log("checkForUpdateAsync", true, "start");
    const result = await client.checkForUpdateAsync();
    log("checkForUpdateAsync", true, checkDetail(result));

    if (result.isAvailable) {
      log("fetchUpdateAsync", true, "start");
      try {
        const fetched = (await client.fetchUpdateAsync()) as OtaFetchResult | undefined;
        // Successful fetch after isAvailable → pending immediately (pending-race fix).
        if (fetched && fetched.isNew === false && !fetched.isRollBackToEmbedded) {
          fetchedPending = false;
        } else {
          fetchedPending = true;
        }
        log("fetchUpdateAsync", true, fetchDetail(fetched));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("fetchUpdateAsync", false, msg);
        return "none";
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("checkForUpdateAsync", false, msg);
    return "none";
  }

  const pending = pendingBefore || isPending() || fetchedPending;
  if (!pending) return "none";
  if (!applyWhenReady) return "pending";

  if (reloadBlocked()) {
    log("reloadAsync", false, "blocked: coach/fantasy critical work");
    return "pending";
  }

  if (!allowSessionAutoReload(updateKey)) {
    log(
      "reloadAsync",
      false,
      `blocked: reload loop guard (${MAX_AUTO_RELOADS_PER_UPDATE}/${GUARD_WINDOW_MS}ms)`,
    );
    return "pending";
  }

  try {
    recordSessionAutoReload(updateKey);
    log("reloadAsync", true, "start");
    await client.reloadAsync({ reloadScreenOptions: { fade: true } });
    return "applied";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("reloadAsync", false, msg);
    return "pending";
  }
}

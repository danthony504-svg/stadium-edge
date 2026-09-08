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

export type OtaCheckResult = {
  isAvailable: boolean;
  isRollBackToEmbedded?: boolean;
  reason?: string;
  manifest?: { id?: string } | null;
};

export type OtaUpdateClient = {
  checkForUpdateAsync: () => Promise<OtaCheckResult>;
  fetchUpdateAsync: () => Promise<OtaFetchResult | void>;
  reloadAsync: (opts?: { reloadScreenOptions?: { fade?: boolean } }) => Promise<void>;
};

export type OtaFetchResult = {
  isNew?: boolean;
  isRollBackToEmbedded?: boolean;
  manifest?: { id?: string } | null;
};

export type OtaLogStep = "checkForUpdateAsync" | "fetchUpdateAsync" | "reloadAsync";
export type OtaLogger = (step: OtaLogStep, ok: boolean, detail: string) => void;

export type OtaPrefetchReport = {
  outcome: OtaPrefetchOutcome;
  availableUpdateId: string | null;
  checkReason: string | null;
  fetchResult: string | null;
  pending: boolean;
  reloadBlocked: boolean;
  lastError: string | null;
  previouslyFailed: boolean;
};

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

/** Remaining ms until the loop guard window expires for this key (0 if allowed now). */
export function reloadGuardRetryDelayMs(updateKey: string, now = Date.now()): number {
  if (allowSessionAutoReload(updateKey, now)) return 0;
  if (!sessionReloadGuard || sessionReloadGuard.updateId !== updateKey) return 0;
  const elapsed = now - sessionReloadGuard.firstAttemptAt;
  return Math.max(1_000, GUARD_WINDOW_MS - elapsed);
}

function checkDetail(check: OtaCheckResult): string {
  if (check.isAvailable) {
    const id = check.manifest?.id;
    return id ? `isAvailable=true id=${id}` : "isAvailable=true";
  }
  if (check.isRollBackToEmbedded) return "rollBackToEmbedded";
  const reason = check.reason ?? "unknown";
  if (reason === "updatePreviouslyFailed") {
    return `isAvailable=false reason=updatePreviouslyFailed (superseding OTA required)`;
  }
  return `isAvailable=false reason=${reason}`;
}

function fetchDetail(fetched: OtaFetchResult | null | undefined): string {
  if (!fetched) return "success";
  if (fetched.isRollBackToEmbedded) return "rollBackToEmbedded";
  const id = fetched.manifest?.id;
  if (fetched.isNew === false) return id ? `isNew=false id=${id}` : "isNew=false";
  if (fetched.isNew === true) return id ? `isNew=true id=${id}` : "isNew=true";
  return id ? `success id=${id}` : "success";
}

function emptyReport(outcome: OtaPrefetchOutcome): OtaPrefetchReport {
  return {
    outcome,
    availableUpdateId: null,
    checkReason: null,
    fetchResult: null,
    pending: outcome === "pending" || outcome === "applied",
    reloadBlocked: false,
    lastError: null,
    previouslyFailed: false,
  };
}

/**
 * Check/fetch always run. Coach/Fantasy/keyboard-style reload blocks only delay reload.
 * A successful fetch after isAvailable is treated as pending immediately (no latestContext wait).
 * Loop-guard keys off the *pending/downloaded* update id — never the currently running id —
 * so a stranded older running bundle cannot permanently block applying a newer download.
 */
export async function prefetchOtaUpdate(
  client: OtaUpdateClient,
  isPending: () => boolean,
  applyWhenReady = false,
  options?: {
    isReloadBlocked?: () => boolean;
    log?: OtaLogger;
    /** Prefer the downloaded/available update id, not the running bundle id. */
    reloadUpdateKey?: string;
  },
): Promise<OtaPrefetchOutcome> {
  const report = await prefetchOtaUpdateDetailed(client, isPending, applyWhenReady, options);
  return report.outcome;
}

export async function prefetchOtaUpdateDetailed(
  client: OtaUpdateClient,
  isPending: () => boolean,
  applyWhenReady = false,
  options?: {
    isReloadBlocked?: () => boolean;
    log?: OtaLogger;
    reloadUpdateKey?: string;
  },
): Promise<OtaPrefetchReport> {
  const log: OtaLogger = options?.log ?? (() => {});
  const reloadBlockedFn = options?.isReloadBlocked ?? (() => false);

  const pendingBefore = isPending();
  let fetchedPending = false;
  let availableUpdateId: string | null = null;
  let checkReason: string | null = null;
  let fetchResult: string | null = null;
  let lastError: string | null = null;
  let previouslyFailed = false;

  try {
    log("checkForUpdateAsync", true, "start");
    const result = await client.checkForUpdateAsync();
    const detail = checkDetail(result);
    log("checkForUpdateAsync", true, detail);
    checkReason = result.reason ?? (result.isAvailable ? "available" : result.isRollBackToEmbedded ? "rollBackToEmbedded" : "unknown");
    previouslyFailed = result.reason === "updatePreviouslyFailed";

    if (result.isAvailable) {
      availableUpdateId = result.manifest?.id ?? null;
      log("fetchUpdateAsync", true, "start");
      try {
        const fetched = (await client.fetchUpdateAsync()) as OtaFetchResult | undefined;
        fetchResult = fetchDetail(fetched);
        // Successful fetch after isAvailable → pending immediately (pending-race fix).
        if (fetched && fetched.isNew === false && !fetched.isRollBackToEmbedded) {
          fetchedPending = false;
        } else {
          fetchedPending = true;
          if (fetched?.manifest?.id) availableUpdateId = fetched.manifest.id;
        }
        log("fetchUpdateAsync", true, fetchResult);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = msg;
        fetchResult = `error: ${msg}`;
        log("fetchUpdateAsync", false, msg);
        return {
          ...emptyReport("none"),
          availableUpdateId,
          checkReason,
          fetchResult,
          lastError,
          previouslyFailed,
        };
      }
    } else if (previouslyFailed) {
      lastError = "updatePreviouslyFailed";
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastError = msg;
    log("checkForUpdateAsync", false, msg);
    return {
      ...emptyReport("none"),
      checkReason: "error",
      lastError,
      previouslyFailed,
    };
  }

  const pending = pendingBefore || isPending() || fetchedPending;
  if (!pending) {
    return {
      outcome: "none",
      availableUpdateId,
      checkReason,
      fetchResult,
      pending: false,
      reloadBlocked: false,
      lastError,
      previouslyFailed,
    };
  }
  if (!applyWhenReady) {
    return {
      outcome: "pending",
      availableUpdateId,
      checkReason,
      fetchResult,
      pending: true,
      reloadBlocked: false,
      lastError,
      previouslyFailed,
    };
  }

  return applyPendingOtaReloadDetailed(client, {
    isReloadBlocked: reloadBlockedFn,
    log,
    reloadUpdateKey:
      options?.reloadUpdateKey ?? availableUpdateId ?? "pending-download",
    availableUpdateId,
    checkReason,
    fetchResult,
    previouslyFailed,
    lastError,
  });
}

/**
 * Apply an already-fetched pending update. Does not re-check the server —
 * avoids losing pending when check returns isAvailable=false after fetch.
 */
export async function applyPendingOtaReload(
  client: Pick<OtaUpdateClient, "reloadAsync">,
  options?: {
    isReloadBlocked?: () => boolean;
    log?: OtaLogger;
    reloadUpdateKey?: string;
  },
): Promise<OtaPrefetchOutcome> {
  const report = await applyPendingOtaReloadDetailed(client, options);
  return report.outcome;
}

export async function applyPendingOtaReloadDetailed(
  client: Pick<OtaUpdateClient, "reloadAsync">,
  options?: {
    isReloadBlocked?: () => boolean;
    log?: OtaLogger;
    reloadUpdateKey?: string;
    availableUpdateId?: string | null;
    checkReason?: string | null;
    fetchResult?: string | null;
    previouslyFailed?: boolean;
    lastError?: string | null;
  },
): Promise<OtaPrefetchReport> {
  const log: OtaLogger = options?.log ?? (() => {});
  const reloadBlockedFn = options?.isReloadBlocked ?? (() => false);
  const updateKey = options?.reloadUpdateKey ?? "pending-download";
  const base = {
    availableUpdateId: options?.availableUpdateId ?? null,
    checkReason: options?.checkReason ?? null,
    fetchResult: options?.fetchResult ?? null,
    previouslyFailed: options?.previouslyFailed ?? false,
    lastError: options?.lastError ?? null,
  };

  if (reloadBlockedFn()) {
    log("reloadAsync", false, "blocked: coach/fantasy critical work");
    return {
      outcome: "pending",
      ...base,
      pending: true,
      reloadBlocked: true,
      lastError: base.lastError,
    };
  }

  if (!allowSessionAutoReload(updateKey)) {
    const delay = reloadGuardRetryDelayMs(updateKey);
    log(
      "reloadAsync",
      false,
      `blocked: reload loop guard for pending=${updateKey.slice(0, 8)}… retry_in_ms=${delay} (${MAX_AUTO_RELOADS_PER_UPDATE}/${GUARD_WINDOW_MS}ms)`,
    );
    return {
      outcome: "pending",
      ...base,
      pending: true,
      // Not coach-blocked — pending download must remain eligible for later retry.
      reloadBlocked: false,
      lastError: `reload_loop_guard retry_in_ms=${delay}`,
    };
  }

  try {
    recordSessionAutoReload(updateKey);
    log("reloadAsync", true, `start pending=${updateKey.slice(0, 8)}…`);
    await client.reloadAsync({ reloadScreenOptions: { fade: true } });
    return {
      outcome: "applied",
      ...base,
      pending: true,
      reloadBlocked: false,
      lastError: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("reloadAsync", false, msg);
    return {
      outcome: "pending",
      ...base,
      pending: true,
      reloadBlocked: false,
      lastError: msg,
    };
  }
}

/**
 * Pure OTA check/fetch/reload transaction — no expo-updates / React Native imports
 * so Node tests can exercise the production path without Metro.
 *
 * Recovery invariants (a client already running an older OTA must be able to
 * reach the newest compatible one):
 *
 *  1. Every terminal decision is logged with a reason. There are no silent
 *     returns, so "nothing in the log" always means "this never ran".
 *  2. A network failure in check or fetch never discards an update that is
 *     already downloaded and pending. The reload is evaluated regardless.
 *  3. The loop guard is keyed on the update a reload would LAUNCH, not on the
 *     one currently running, so an exhausted budget cannot block a superseding
 *     update published to recover the device.
 *  4. Reloading a known-pending update does not require a fresh network check.
 */

import type { OtaRecoverySnapshot } from "./otaRecoveryState.ts";
import {
  MAX_AUTO_RELOADS_PER_UPDATE,
  resolveReloadTargetId,
  SESSION_RELOAD_COOLDOWN_MS,
  shouldAllowAutoReload,
  type OtaReloadGuard,
} from "./otaReloadGuard.ts";

export type OtaPrefetchOutcome = "applied" | "pending" | "none";

export type OtaManifestRef = { id?: string } | null | undefined;

export type OtaCheckResult = {
  isAvailable: boolean;
  isRollBackToEmbedded?: boolean;
  reason?: string;
  manifest?: OtaManifestRef;
};

export type OtaFetchResult = {
  isNew?: boolean;
  isRollBackToEmbedded?: boolean;
  manifest?: OtaManifestRef;
};

export type OtaUpdateClient = {
  checkForUpdateAsync: () => Promise<OtaCheckResult>;
  fetchUpdateAsync: () => Promise<OtaFetchResult | void>;
  reloadAsync: (opts?: { reloadScreenOptions?: { fade?: boolean } }) => Promise<void>;
};

export type OtaLogStep = "checkForUpdateAsync" | "fetchUpdateAsync" | "reloadAsync";
export type OtaLogger = (step: OtaLogStep, ok: boolean, detail: string) => void;

export type OtaRecoveryReporter = (patch: Partial<OtaRecoverySnapshot>) => void;

export type OtaUpdaterOptions = {
  /** Coach/Fantasy critical work — delays reload only, never check or fetch. */
  isReloadBlocked?: () => boolean;
  log?: OtaLogger;
  /** Running update id, used only as the unknown-target fallback key. */
  reloadUpdateKey?: string;
  /** Id of an already-downloaded update, read fresh each time it is needed. */
  downloadedUpdateId?: () => string | null | undefined;
  /** True when this specific target has repeatedly failed to launch. */
  isTargetPreviouslyFailed?: (targetId: string) => boolean;
  /**
   * Persist the target before restarting so the next launch can reconcile it.
   * Awaited: reloadAsync can tear the process down before a fire-and-forget
   * write flushes, which would silently disable failed-launch detection.
   */
  onReloadTarget?: (targetId: string) => void | Promise<void>;
  report?: OtaRecoveryReporter;
};

/** In-memory auto-reload loop guard (JS session only). */
let sessionReloadGuard: OtaReloadGuard | null = null;

export function resetOtaUpdaterSessionGuardForTests(): void {
  sessionReloadGuard = null;
}

function recordSessionAutoReload(updateKey: string, now = Date.now()): void {
  if (
    !sessionReloadGuard ||
    sessionReloadGuard.updateId !== updateKey ||
    now - sessionReloadGuard.firstAttemptAt > SESSION_RELOAD_COOLDOWN_MS
  ) {
    sessionReloadGuard = { updateId: updateKey, attempts: 1, firstAttemptAt: now };
    return;
  }
  sessionReloadGuard = { ...sessionReloadGuard, attempts: sessionReloadGuard.attempts + 1 };
}

function checkDetail(check: OtaCheckResult): string {
  const id = check.manifest?.id ? ` id=${check.manifest.id}` : "";
  if (check.isRollBackToEmbedded) return "rollBackToEmbedded";
  if (check.isAvailable) return `isAvailable=true${id}`;
  return `isAvailable=false reason=${check.reason ?? "unknown"}`;
}

function fetchDetail(fetched: OtaFetchResult | null | undefined): string {
  if (!fetched) return "success";
  const id = fetched.manifest?.id ? ` id=${fetched.manifest.id}` : "";
  if (fetched.isRollBackToEmbedded) return "rollBackToEmbedded";
  if (fetched.isNew === false) return "isNew=false";
  return `isNew=true${id}`;
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.name ? `${e.name}: ${e.message}` : e.message;
  return String(e);
}

/**
 * Reload into an update already known to be pending.
 *
 * Deliberately performs NO network call: re-checking before a reload means a
 * flaky check can discard a bundle that is already fully downloaded on disk.
 */
export async function reloadPendingOtaUpdate(
  client: Pick<OtaUpdateClient, "reloadAsync">,
  targetId: string,
  options?: Pick<
    OtaUpdaterOptions,
    "isReloadBlocked" | "log" | "isTargetPreviouslyFailed" | "onReloadTarget" | "report"
  >,
): Promise<OtaPrefetchOutcome> {
  const log: OtaLogger = options?.log ?? (() => {});
  const report: OtaRecoveryReporter = options?.report ?? (() => {});
  const blocked = options?.isReloadBlocked ?? (() => false);

  report({ reloadTargetId: targetId });

  if (blocked()) {
    const detail = "blocked: coach/fantasy critical work";
    log("reloadAsync", false, detail);
    report({ reloadBlocked: true, reloadBlockedReason: detail });
    return "pending";
  }

  if (options?.isTargetPreviouslyFailed?.(targetId)) {
    const detail = `blocked: ${targetId} previously failed to launch — waiting for a newer update`;
    log("reloadAsync", false, detail);
    report({
      reloadBlocked: true,
      reloadBlockedReason: detail,
      updatePreviouslyFailed: true,
    });
    return "pending";
  }

  if (!shouldAllowAutoReload(sessionReloadGuard, targetId, Date.now(), SESSION_RELOAD_COOLDOWN_MS)) {
    // Rate limit only — the cooldown expires, so the update is retried later.
    const detail = `throttled: ${MAX_AUTO_RELOADS_PER_UPDATE} reloads for ${targetId} in ${SESSION_RELOAD_COOLDOWN_MS}ms`;
    log("reloadAsync", false, detail);
    report({ reloadBlocked: true, reloadBlockedReason: detail });
    return "pending";
  }

  try {
    recordSessionAutoReload(targetId);
    await options?.onReloadTarget?.(targetId);
    log("reloadAsync", true, `start target=${targetId}`);
    report({ reloadBlocked: false, reloadBlockedReason: "—" });
    await client.reloadAsync({ reloadScreenOptions: { fade: true } });
    return "applied";
  } catch (e) {
    const detail = errText(e);
    log("reloadAsync", false, detail);
    report({ lastError: `reloadAsync: ${detail}` });
    return "pending";
  }
}

/**
 * Check, fetch, and (optionally) apply a production OTA.
 *
 * Check and fetch always run. Reload blocks only delay the reload. A successful
 * fetch is treated as pending immediately rather than waiting for the native
 * state context to catch up.
 */
export async function prefetchOtaUpdate(
  client: OtaUpdateClient,
  isPending: () => boolean,
  applyWhenReady = false,
  options?: OtaUpdaterOptions,
): Promise<OtaPrefetchOutcome> {
  const log: OtaLogger = options?.log ?? (() => {});
  const report: OtaRecoveryReporter = options?.report ?? (() => {});
  const runningUpdateId = options?.reloadUpdateKey ?? null;

  const pendingBefore = isPending();
  let fetchedPending = false;
  let availableUpdateId: string | null = null;
  let fetchedUpdateId: string | null = null;

  log("checkForUpdateAsync", true, "start");
  let check: OtaCheckResult | null = null;
  try {
    check = await client.checkForUpdateAsync();
    const detail = checkDetail(check);
    log("checkForUpdateAsync", true, detail);
    availableUpdateId = check.manifest?.id?.trim() || null;
    report({
      checkResult: detail,
      availableUpdateId: availableUpdateId ?? "—",
      // Native selection policy refuses an update it has already failed to launch.
      updatePreviouslyFailed: check.reason === "updatePreviouslyFailed",
    });
  } catch (e) {
    const detail = errText(e);
    log("checkForUpdateAsync", false, detail);
    // A failed check must not discard an update that is already downloaded.
    report({ checkResult: `ERR: ${detail}`, lastError: `checkForUpdateAsync: ${detail}` });
  }

  if (check && (check.isAvailable || check.isRollBackToEmbedded)) {
    log("fetchUpdateAsync", true, "start");
    try {
      const fetched = (await client.fetchUpdateAsync()) as OtaFetchResult | undefined;
      const detail = fetchDetail(fetched);
      // A fetch that resolves after isAvailable is pending immediately; only an
      // explicit isNew=false (and no rollback) means nothing was staged.
      fetchedPending = !(fetched && fetched.isNew === false && !fetched.isRollBackToEmbedded);
      fetchedUpdateId = fetched?.manifest?.id?.trim() || null;
      log("fetchUpdateAsync", true, detail);
      report({ fetchResult: detail });
    } catch (e) {
      const detail = errText(e);
      log("fetchUpdateAsync", false, detail);
      // Same rule as check: a fetch failure cannot strand a pending update.
      report({ fetchResult: `ERR: ${detail}`, lastError: `fetchUpdateAsync: ${detail}` });
    }
  } else if (check) {
    const detail = `not attempted (${checkDetail(check)})`;
    report({ fetchResult: detail });
  }

  const pending = pendingBefore || isPending() || fetchedPending;
  report({ pending });

  const targetId = resolveReloadTargetId({
    downloadedUpdateId: fetchedUpdateId ?? options?.downloadedUpdateId?.(),
    availableUpdateId,
    runningUpdateId,
  });
  report({ reloadTargetId: targetId });

  if (!pending) {
    log("reloadAsync", false, "skipped: no pending update");
    report({ reloadBlocked: false, reloadBlockedReason: "no pending update" });
    return "none";
  }

  if (!applyWhenReady) {
    log("reloadAsync", false, `deferred: pending target=${targetId} (apply on next safe moment)`);
    return "pending";
  }

  return reloadPendingOtaUpdate(client, targetId, options);
}

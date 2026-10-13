/**
 * Single owner of production OTA update state.
 *
 * States: idle → checking → downloading → ready → restarting
 *                    ↘ idle          ↘ error
 *
 * Rules (non-negotiable):
 * - No automatic reloadAsync
 * - reloadAsync only via restart() (Restart button)
 * - Banner only when state===ready && downloadedUpdateId != runningUpdateId
 * - updatePreviouslyFailed → error, never auto-retry that id
 * - noteReloadTarget BEFORE reloadAsync so boot can distinguish launch vs selection failure
 */

import { classifyOtaApplyFailure } from "../otaApplyFailureClassify.ts";
import {
  DEFAULT_FOREGROUND_COOLDOWN_MS,
  OTA_PREVIOUSLY_FAILED,
  type OtaClient,
  type OtaFailedLaunchHooks,
  type OtaLaunchOutcome,
  type OtaSnapshot,
  type OtaState,
} from "./types.ts";

function idsEqual(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isDistinctDownload(
  downloadedUpdateId: string | null,
  runningUpdateId: string | null,
): boolean {
  if (!downloadedUpdateId) return false;
  if (runningUpdateId == null) return true;
  return !idsEqual(downloadedUpdateId, runningUpdateId);
}

export function computeBannerVisible(input: {
  state: OtaState;
  downloadedUpdateId: string | null;
  runningUpdateId: string | null;
}): boolean {
  return (
    input.state === "ready" &&
    isDistinctDownload(input.downloadedUpdateId, input.runningUpdateId)
  );
}

export type OtaControllerOptions = {
  cooldownMs?: number;
  /** Optional clock for tests. */
  now?: () => number;
  /** JS failed-launch ledger (AsyncStorage-backed in production). */
  failedLaunchHooks?: OtaFailedLaunchHooks;
};

export class OtaController {
  private state: OtaState = "idle";
  private runningUpdateId: string | null = null;
  private discoveredUpdateId: string | null = null;
  private downloadedUpdateId: string | null = null;
  private lastError: string | null = null;
  private failedUpdateId: string | null = null;
  private lastCheckedAt: number | null = null;
  private lastRestartTargetId: string | null = null;
  private launchOutcome: OtaLaunchOutcome = "unknown";
  private launchOutcomeDetail: string | null = null;
  private checkInFlight = false;
  private readonly client: OtaClient;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly failedLaunchHooks?: OtaFailedLaunchHooks;
  private readonly listeners = new Set<() => void>();

  constructor(client: OtaClient, opts?: OtaControllerOptions) {
    this.client = client;
    this.cooldownMs = opts?.cooldownMs ?? DEFAULT_FOREGROUND_COOLDOWN_MS;
    this.now = opts?.now ?? Date.now;
    this.failedLaunchHooks = opts?.failedLaunchHooks;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): OtaSnapshot {
    return {
      state: this.state,
      runningUpdateId: this.runningUpdateId,
      discoveredUpdateId: this.discoveredUpdateId,
      downloadedUpdateId: this.downloadedUpdateId,
      lastError: this.lastError,
      failedUpdateId: this.failedUpdateId,
      lastCheckedAt: this.lastCheckedAt,
      bannerVisible: computeBannerVisible({
        state: this.state,
        downloadedUpdateId: this.downloadedUpdateId,
        runningUpdateId: this.runningUpdateId,
      }),
      lastRestartTargetId: this.lastRestartTargetId,
      launchOutcome: this.launchOutcome,
      launchOutcomeDetail: this.launchOutcomeDetail,
    };
  }

  /**
   * After app mount — never reloads. Clears ready if we already boot into the
   * previously downloaded id (or native downloaded id matches running).
   * Reconciles the JS failed-launch ledger to classify launch vs selection failure.
   */
  boot(): OtaSnapshot {
    this.runningUpdateId = this.client.getRunningUpdateId();
    const nativeDownloaded = this.client.getDownloadedUpdateId();

    if (
      this.downloadedUpdateId &&
      idsEqual(this.runningUpdateId, this.downloadedUpdateId)
    ) {
      this.downloadedUpdateId = null;
      this.discoveredUpdateId = null;
    }

    if (
      nativeDownloaded &&
      idsEqual(this.runningUpdateId, nativeDownloaded)
    ) {
      this.downloadedUpdateId = null;
      this.discoveredUpdateId = null;
    }

    // Sticky native pending with no distinct downloaded id must not become ready.
    this.state = "idle";
    this.lastError = null;
    this.emit();

    // Async reconcile — never blocks boot / never reloads.
    void this.reconcileFailedLaunchLedger();

    return this.getSnapshot();
  }

  private async reconcileFailedLaunchLedger(): Promise<void> {
    const hooks = this.failedLaunchHooks;
    let observed: "no-target" | "launched" | "failed" | null = null;
    let failedTargetId: string | undefined;
    let failedCount: number | undefined;

    if (hooks) {
      try {
        const result = await hooks.reconcileBoot(this.runningUpdateId);
        observed = result.observed;
        failedTargetId = result.failedTargetId;
        failedCount = result.failedCount;
        if (result.observed === "failed" && result.failedTargetId) {
          this.failedUpdateId = result.failedTargetId;
          this.lastRestartTargetId = result.failedTargetId;
        }
        if (result.observed === "launched") {
          this.lastRestartTargetId = this.runningUpdateId;
        }
      } catch {
        observed = null;
      }
    }

    const classified = classifyOtaApplyFailure({
      reconcileObserved: observed,
      failedTargetId,
      failedCount,
      isEmbeddedLaunch: !!this.client.isEmbeddedLaunch?.(),
      isEmergencyLaunch: !!this.client.isEmergencyLaunch?.(),
      emergencyLaunchReason: this.client.emergencyLaunchReason?.() ?? null,
      runningUpdateId: this.runningUpdateId,
      lastRestartTargetId: this.lastRestartTargetId,
      updatePreviouslyFailedReason: false,
    });

    this.launchOutcome = classified.kind;
    this.launchOutcomeDetail = `${classified.label}: ${classified.summary}`;
    this.emit();
  }

  /**
   * Foreground / resume: check only when idle|error, cooldown elapsed,
   * and client enabled. Never reloads.
   */
  async onForeground(): Promise<OtaSnapshot> {
    if (this.state !== "idle" && this.state !== "error") {
      return this.getSnapshot();
    }
    if (
      this.lastCheckedAt != null &&
      this.now() - this.lastCheckedAt < this.cooldownMs
    ) {
      return this.getSnapshot();
    }
    return this.check();
  }

  /**
   * Block Updates network I/O while native startup/relaunch is still running.
   * Tip `01a13540` blacklisted after check/reload raced ErrorRecovery before
   * RCTContentDidAppear → failedLaunchCount>0 → updatePreviouslyFailed.
   */
  isStartupBlocking(): boolean {
    return !!this.client.isStartupProcedureRunning?.();
  }

  private startupBlocksNetwork(): boolean {
    return this.isStartupBlocking();
  }

  /** Launch / manual / foreground check path. Never calls reloadAsync. */
  async check(): Promise<OtaSnapshot> {
    if (!this.client.isEnabled()) {
      this.state = "idle";
      this.emit();
      return this.getSnapshot();
    }
    if (this.checkInFlight) return this.getSnapshot();
    if (
      this.state === "checking" ||
      this.state === "downloading" ||
      this.state === "restarting" ||
      this.state === "ready"
    ) {
      return this.getSnapshot();
    }

    if (this.startupBlocksNetwork()) {
      this.state = "idle";
      this.lastError =
        "deferred: isStartupProcedureRunning=true (avoid tip-boot Updates I/O)";
      this.launchOutcomeDetail = this.lastError;
      this.emit();
      return this.getSnapshot();
    }

    this.checkInFlight = true;
    this.state = "checking";
    this.lastError = null;
    this.lastCheckedAt = this.now();
    this.runningUpdateId = this.client.getRunningUpdateId();
    this.emit();

    try {
      // Re-check immediately before the native call — startup can flip true
      // between the gate above and here on a slow tip boot.
      if (this.startupBlocksNetwork()) {
        this.state = "idle";
        this.lastError =
          "deferred: isStartupProcedureRunning=true (avoid tip-boot Updates I/O)";
        this.launchOutcomeDetail = this.lastError;
        this.emit();
        return this.getSnapshot();
      }

      const result = await this.client.checkForUpdateAsync();
      const reason = result.reason ?? null;
      const discovered = result.manifestId ? String(result.manifestId) : null;

      if (reason === OTA_PREVIOUSLY_FAILED) {
        this.state = "error";
        this.failedUpdateId = discovered ?? this.failedUpdateId;
        this.lastError = OTA_PREVIOUSLY_FAILED;
        this.discoveredUpdateId = discovered;
        this.launchOutcome = "launch_failed";
        this.launchOutcomeDetail =
          "native checkForUpdateAsync reason=updatePreviouslyFailed";
        this.emit();
        return this.getSnapshot();
      }

      if (!result.isAvailable) {
        this.state = "idle";
        this.discoveredUpdateId = null;
        this.emit();
        return this.getSnapshot();
      }

      this.discoveredUpdateId = discovered;

      if (discovered && idsEqual(discovered, this.runningUpdateId)) {
        this.state = "idle";
        this.emit();
        return this.getSnapshot();
      }

      if (discovered && idsEqual(discovered, this.failedUpdateId)) {
        this.state = "error";
        this.lastError = `${OTA_PREVIOUSLY_FAILED} (not retrying ${discovered})`;
        this.emit();
        return this.getSnapshot();
      }

      this.state = "downloading";
      this.emit();

      const fetched = await this.client.fetchUpdateAsync();
      const downloaded =
        (fetched.manifestId ? String(fetched.manifestId) : null) ??
        this.client.getDownloadedUpdateId() ??
        discovered;

      this.downloadedUpdateId = downloaded;

      if (isDistinctDownload(downloaded, this.runningUpdateId)) {
        this.state = "ready";
        this.lastError = null;
      } else {
        // Sticky isUpdatePending / unknown downloaded id → no banner, no reload.
        this.state = "idle";
        this.downloadedUpdateId = null;
        this.lastError =
          "fetch finished without a distinct downloaded update id";
        this.launchOutcome = "selection_failed";
        this.launchOutcomeDetail = this.lastError;
      }
      this.emit();
      return this.getSnapshot();
    } catch (e) {
      this.state = "error";
      this.lastError = e instanceof Error ? e.message : String(e);
      this.emit();
      return this.getSnapshot();
    } finally {
      this.checkInFlight = false;
    }
  }

  /**
   * Explicit user Restart only. Exactly one reloadAsync when accepted.
   * Persists the target id BEFORE reload so the next boot can classify
   * launch_failed vs selection_failed.
   */
  async restart(): Promise<"reloaded" | "rejected"> {
    const snap = this.getSnapshot();
    if (snap.state !== "ready") return "rejected";
    if (!snap.downloadedUpdateId) return "rejected";
    if (!isDistinctDownload(snap.downloadedUpdateId, snap.runningUpdateId)) {
      return "rejected";
    }

    // Never reload while native startup is still owning the launch — that is
    // the tip-boot blacklist pattern (01a131bc / 01a13540 class).
    if (this.startupBlocksNetwork()) {
      this.state = "error";
      this.lastError =
        "restart deferred: isStartupProcedureRunning=true (would blacklist tip)";
      this.launchOutcome = "selection_failed";
      this.launchOutcomeDetail = this.lastError;
      this.emit();
      return "rejected";
    }

    const targetId = snap.downloadedUpdateId;
    this.lastRestartTargetId = targetId;
    this.state = "restarting";
    this.emit();

    // Await ledger write — reloadAsync can tear down JS before a fire-and-forget flush.
    if (this.failedLaunchHooks) {
      try {
        await this.failedLaunchHooks.noteReloadTarget(targetId);
      } catch {
        // Non-fatal: still attempt reload; classification may degrade to selection_failed.
      }
    }

    try {
      await this.client.reloadAsync();
      return "reloaded";
    } catch (e) {
      this.state = "error";
      this.lastError = e instanceof Error ? e.message : String(e);
      this.launchOutcome = "selection_failed";
      this.launchOutcomeDetail = `reloadAsync threw: ${this.lastError}`;
      this.emit();
      return "rejected";
    }
  }

  /** Test / diagnostics helper — does not call Expo. */
  replaceSnapshotForTests(partial: Partial<OtaSnapshot>): void {
    if (partial.state != null) this.state = partial.state;
    if (partial.runningUpdateId !== undefined) {
      this.runningUpdateId = partial.runningUpdateId;
    }
    if (partial.discoveredUpdateId !== undefined) {
      this.discoveredUpdateId = partial.discoveredUpdateId;
    }
    if (partial.downloadedUpdateId !== undefined) {
      this.downloadedUpdateId = partial.downloadedUpdateId;
    }
    if (partial.lastError !== undefined) this.lastError = partial.lastError;
    if (partial.failedUpdateId !== undefined) {
      this.failedUpdateId = partial.failedUpdateId;
    }
    if (partial.lastCheckedAt !== undefined) {
      this.lastCheckedAt = partial.lastCheckedAt;
    }
    if (partial.lastRestartTargetId !== undefined) {
      this.lastRestartTargetId = partial.lastRestartTargetId;
    }
    if (partial.launchOutcome !== undefined) {
      this.launchOutcome = partial.launchOutcome;
    }
    if (partial.launchOutcomeDetail !== undefined) {
      this.launchOutcomeDetail = partial.launchOutcomeDetail;
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // listeners must not break the controller
      }
    }
  }
}

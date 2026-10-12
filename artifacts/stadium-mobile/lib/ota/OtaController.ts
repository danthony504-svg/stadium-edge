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
 */

import {
  DEFAULT_FOREGROUND_COOLDOWN_MS,
  OTA_PREVIOUSLY_FAILED,
  type OtaClient,
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
};

export class OtaController {
  private state: OtaState = "idle";
  private runningUpdateId: string | null = null;
  private discoveredUpdateId: string | null = null;
  private downloadedUpdateId: string | null = null;
  private lastError: string | null = null;
  private failedUpdateId: string | null = null;
  private lastCheckedAt: number | null = null;
  private checkInFlight = false;
  private readonly client: OtaClient;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();

  constructor(client: OtaClient, opts?: OtaControllerOptions) {
    this.client = client;
    this.cooldownMs = opts?.cooldownMs ?? DEFAULT_FOREGROUND_COOLDOWN_MS;
    this.now = opts?.now ?? Date.now;
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
    };
  }

  /**
   * After app mount — never reloads. Clears ready if we already boot into the
   * previously downloaded id (or native downloaded id matches running).
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
    return this.getSnapshot();
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

    this.checkInFlight = true;
    this.state = "checking";
    this.lastError = null;
    this.lastCheckedAt = this.now();
    this.runningUpdateId = this.client.getRunningUpdateId();
    this.emit();

    try {
      const result = await this.client.checkForUpdateAsync();
      const reason = result.reason ?? null;
      const discovered = result.manifestId ? String(result.manifestId) : null;

      if (reason === OTA_PREVIOUSLY_FAILED) {
        this.state = "error";
        this.failedUpdateId = discovered ?? this.failedUpdateId;
        this.lastError = OTA_PREVIOUSLY_FAILED;
        this.discoveredUpdateId = discovered;
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
   */
  async restart(): Promise<"reloaded" | "rejected"> {
    const snap = this.getSnapshot();
    if (snap.state !== "ready") return "rejected";
    if (!snap.downloadedUpdateId) return "rejected";
    if (!isDistinctDownload(snap.downloadedUpdateId, snap.runningUpdateId)) {
      return "rejected";
    }

    this.state = "restarting";
    this.emit();
    try {
      await this.client.reloadAsync();
      return "reloaded";
    } catch (e) {
      this.state = "error";
      this.lastError = e instanceof Error ? e.message : String(e);
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

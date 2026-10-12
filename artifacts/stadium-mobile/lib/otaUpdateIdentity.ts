/**
 * Expo update identity helpers — pure, no expo-updates / RN imports.
 *
 * Multiple OTAs share the same runtimeVersion / app version / channel. Banner
 * and prefetch must compare update UUIDs (Updates.updateId vs downloaded /
 * available manifest id), not version strings or a sticky boolean.
 */

/**
 * Bundle marker proving this JS includes the rare-banner identity gate.
 * Not app version / runtimeVersion — bump only when identity logic changes.
 * Devices without this field are on a pre-fix OTA.
 *
 * v2: sticky isUpdatePending with no distinct downloaded/available id must not
 * arm reload (prevents reloadAsync boot loop → updatePreviouslyFailed).
 */
export const OTA_IDENTITY_FIX_VERSION = 2;

/** Canonical form for Expo update UUIDs (expo-updates always lowercases). */
export function normalizeOtaUpdateId(
  id: string | null | undefined,
): string | null {
  const t = String(id ?? "").trim().toLowerCase();
  if (!t || t === "—" || t === "-" || t === "embedded" || t === "pending") {
    return null;
  }
  return t;
}

/** True when two update ids refer to the same Expo update. */
export function otaUpdateIdsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeOtaUpdateId(a);
  const nb = normalizeOtaUpdateId(b);
  if (!na || !nb) return false;
  return na === nb;
}

export type OtaPendingUiInput = {
  /** Updates.updateId for the currently running bundle (null/embedded ok). */
  runningUpdateId?: string | null;
  /** latestContext.downloadedManifest.id (or equivalent). */
  downloadedUpdateId?: string | null;
  /** Native latestContext.isUpdatePending. */
  isUpdatePending?: boolean;
  /** Native latestContext.isDownloading. */
  isDownloading?: boolean;
  /**
   * Optional available/check manifest id. When equal to running, there is no
   * newer update even if native pending is stuck true.
   */
  availableUpdateId?: string | null;
};

/**
 * Whether the UI should show "App update ready" / treat an update as pending.
 *
 * Rules:
 *  - downloaded/available id === running id → NOT pending (already applied)
 *  - native isUpdatePending with NO distinct target id → NOT pending
 *    (sticky flag after reloadAsync into a tip; re-arming reload here is what
 *    Expo records as updatePreviouslyFailed — see July f16710eb)
 *  - otherwise honor native isUpdatePending when a distinct target id exists
 */
export function isGenuinelyPendingOtaUpdate(input: OtaPendingUiInput): boolean {
  const running = normalizeOtaUpdateId(input.runningUpdateId);
  const downloaded = normalizeOtaUpdateId(input.downloadedUpdateId);
  const available = normalizeOtaUpdateId(input.availableUpdateId);

  // Already running the downloaded (or offered) update — never show ready.
  if (running && downloaded && running === downloaded) return false;
  if (running && available && running === available) return false;

  // No concrete newer target → ignore sticky native pending. Without this,
  // useOtaUpdater calls reloadAsync during tip boot and Expo blacklists the tip.
  if (!downloaded && !available) return false;

  return !!input.isUpdatePending;
}

/**
 * Whether check/fetch found a genuinely newer update than the one running.
 * Same-id offers must not re-fetch or re-arm the banner.
 */
export function isNewerThanRunningUpdate(opts: {
  runningUpdateId?: string | null;
  candidateUpdateId?: string | null;
  /** Roll back to embedded is always "newer" for apply purposes. */
  isRollBackToEmbedded?: boolean;
}): boolean {
  if (opts.isRollBackToEmbedded) return true;
  const candidate = normalizeOtaUpdateId(opts.candidateUpdateId);
  if (!candidate) {
    // No id on the offer — treat as newer only when we are not already sure
    // it matches running (unknown candidate keeps prior "available" behavior
    // for rollback-less manifests without ids; callers pass id when present).
    return true;
  }
  const running = normalizeOtaUpdateId(opts.runningUpdateId);
  if (running && running === candidate) return false;
  return true;
}

/**
 * Persistable "update ready" flag shape. Cleared when running id matches the
 * ready id so close/reopen cannot resurrect a stale banner.
 */
export type OtaReadyFlag = {
  readyUpdateId: string;
  markedAt: number;
};

export const OTA_READY_FLAG_KEY = "@stadium/ota-update-ready";

/** Parse a stored ready flag; invalid JSON → null. */
export function parseOtaReadyFlag(raw: string | null | undefined): OtaReadyFlag | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OtaReadyFlag>;
    const id = normalizeOtaUpdateId(parsed.readyUpdateId);
    const markedAt = Number(parsed.markedAt);
    if (!id || !Number.isFinite(markedAt)) return null;
    return { readyUpdateId: id, markedAt };
  } catch {
    return null;
  }
}

/**
 * After boot: if the ready flag's update is now running, clear it.
 * Returns the flag to keep (null = clear storage).
 */
export function reconcileOtaReadyFlag(
  flag: OtaReadyFlag | null,
  runningUpdateId: string | null | undefined,
): OtaReadyFlag | null {
  if (!flag) return null;
  if (otaUpdateIdsEqual(flag.readyUpdateId, runningUpdateId)) return null;
  return flag;
}

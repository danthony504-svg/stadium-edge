/**
 * Per-update failed-launch ledger — pure logic, storage injected, so Node tests
 * can exercise it without AsyncStorage or expo-updates.
 *
 * expo-updates reports `updatePreviouslyFailed` as a check reason once its
 * native selection policy has given up on an update, but it exposes no count
 * and no way to tell WHICH update it gave up on. Without that, a client cannot
 * distinguish "this bundle is broken, wait for a newer one" from "the reload
 * never happened". This ledger records the reload target before restarting and
 * reconciles it on the next launch: if we asked to launch T and came back
 * running something else, T failed to launch.
 *
 * The ledger is keyed per update id. That is what lets a newly published,
 * superseding update recover a device whose previous target was marked failed —
 * a different id starts with a clean record.
 */

/** Stop auto-reloading into a target that has failed to launch this many times. */
export const MAX_FAILED_LAUNCHES_PER_UPDATE = 2;

/** Ledger entries older than this are dropped so a stale failure cannot last forever. */
export const FAILED_LAUNCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cap on retained ids so the record cannot grow without bound. */
const MAX_TRACKED_UPDATES = 12;

export type OtaFailedLaunchRecord = {
  /** Target we called reloadAsync for but have not yet confirmed running. */
  pendingTargetId?: string | null;
  pendingTargetAt?: number | null;
  /** Failed-launch count per update id. */
  failures: Record<string, { count: number; lastAt: number }>;
};

export type OtaFailedLaunchStorage = {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
};

export const OTA_FAILED_LAUNCH_KEY = "@stadium/ota-failed-launch";

export function emptyFailedLaunchRecord(): OtaFailedLaunchRecord {
  return { pendingTargetId: null, pendingTargetAt: null, failures: {} };
}

export function parseFailedLaunchRecord(raw: string | null): OtaFailedLaunchRecord {
  if (!raw) return emptyFailedLaunchRecord();
  try {
    const parsed = JSON.parse(raw) as Partial<OtaFailedLaunchRecord>;
    const failures: OtaFailedLaunchRecord["failures"] = {};
    for (const [id, entry] of Object.entries(parsed?.failures ?? {})) {
      const count = Number((entry as { count?: number })?.count);
      const lastAt = Number((entry as { lastAt?: number })?.lastAt);
      if (!id || !Number.isFinite(count) || count <= 0) continue;
      failures[id] = { count, lastAt: Number.isFinite(lastAt) ? lastAt : 0 };
    }
    return {
      pendingTargetId: parsed?.pendingTargetId ?? null,
      pendingTargetAt: Number.isFinite(Number(parsed?.pendingTargetAt))
        ? Number(parsed?.pendingTargetAt)
        : null,
      failures,
    };
  } catch {
    return emptyFailedLaunchRecord();
  }
}

function prune(record: OtaFailedLaunchRecord, now: number): OtaFailedLaunchRecord {
  const fresh = Object.entries(record.failures)
    .filter(([, entry]) => now - entry.lastAt <= FAILED_LAUNCH_TTL_MS)
    .sort((a, b) => b[1].lastAt - a[1].lastAt)
    .slice(0, MAX_TRACKED_UPDATES);
  return { ...record, failures: Object.fromEntries(fresh) };
}

/**
 * Reconcile a recorded reload target against the update actually running now.
 *
 * Returns the updated record plus what was observed, so the caller can log it.
 * A recorded target that matches the running update is a success and clears any
 * accumulated failures for that id.
 */
export function reconcileLaunch(
  record: OtaFailedLaunchRecord,
  runningUpdateId: string | null | undefined,
  now = Date.now(),
): {
  record: OtaFailedLaunchRecord;
  observed: "no-target" | "launched" | "failed";
  failedTargetId?: string;
  failedCount?: number;
} {
  const target = record.pendingTargetId?.trim();
  const running = runningUpdateId?.trim() || null;

  if (!target) return { record: prune(record, now), observed: "no-target" };

  const cleared: OtaFailedLaunchRecord = {
    ...record,
    pendingTargetId: null,
    pendingTargetAt: null,
  };

  if (running && running === target) {
    const failures = { ...cleared.failures };
    delete failures[target];
    return { record: prune({ ...cleared, failures }, now), observed: "launched" };
  }

  const prev = cleared.failures[target]?.count ?? 0;
  const count = prev + 1;
  return {
    record: prune({ ...cleared, failures: { ...cleared.failures, [target]: { count, lastAt: now } } }, now),
    observed: "failed",
    failedTargetId: target,
    failedCount: count,
  };
}

export function failedLaunchCount(record: OtaFailedLaunchRecord, updateId: string): number {
  return record.failures[updateId]?.count ?? 0;
}

/**
 * True when this specific update has failed to launch enough times that
 * retrying it is pointless. Any OTHER update id is unaffected, which is what
 * allows a superseding publish to recover the device.
 */
export function isUpdatePreviouslyFailed(
  record: OtaFailedLaunchRecord,
  updateId: string,
): boolean {
  return failedLaunchCount(record, updateId) >= MAX_FAILED_LAUNCHES_PER_UPDATE;
}

export function noteReloadTarget(
  record: OtaFailedLaunchRecord,
  targetId: string,
  now = Date.now(),
): OtaFailedLaunchRecord {
  return { ...record, pendingTargetId: targetId, pendingTargetAt: now };
}

/** Load the ledger; a storage failure degrades to an empty record. */
export async function readFailedLaunchRecord(
  storage: Pick<OtaFailedLaunchStorage, "read">,
): Promise<OtaFailedLaunchRecord> {
  try {
    return parseFailedLaunchRecord(await storage.read());
  } catch {
    return emptyFailedLaunchRecord();
  }
}

/** Persist the ledger; failures are non-fatal so they cannot block an OTA. */
export async function writeFailedLaunchRecord(
  storage: Pick<OtaFailedLaunchStorage, "write">,
  record: OtaFailedLaunchRecord,
): Promise<void> {
  try {
    await storage.write(JSON.stringify(record));
  } catch {
    // best-effort
  }
}

/** Load, mutate, and persist in one step; storage failures degrade to in-memory. */
export async function updateFailedLaunchRecord(
  storage: OtaFailedLaunchStorage,
  mutate: (record: OtaFailedLaunchRecord) => OtaFailedLaunchRecord,
): Promise<OtaFailedLaunchRecord> {
  const next = mutate(await readFailedLaunchRecord(storage));
  await writeFailedLaunchRecord(storage, next);
  return next;
}

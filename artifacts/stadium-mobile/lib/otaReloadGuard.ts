/** Pure loop-guard logic — no expo-updates imports (testable in Node). */

export type OtaReloadGuard = {
  /** The update we are trying to LAUNCH, never the one currently running. */
  updateId: string;
  attempts: number;
  firstAttemptAt: number;
};

/** Max automatic reload attempts per update id before backing off (rollback loop protection). */
export const MAX_AUTO_RELOADS_PER_UPDATE = 2;
export const GUARD_WINDOW_MS = 60 * 60 * 1000;

/**
 * Cooldown for the in-session reload rate limiter.
 *
 * Deliberately much shorter than GUARD_WINDOW_MS. Inside one JS session the
 * only way to consume this budget is a reloadAsync that did NOT restart the
 * app, and abandoning a fully downloaded update for an hour because of that is
 * the strand this exists to avoid. Genuine rollback-loop protection belongs to
 * the persisted per-update failed-launch ledger, which counts CONFIRMED failed
 * launches instead of attempts.
 */
export const SESSION_RELOAD_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Namespace for the fallback key used when no target update id is known. It can
 * never collide with a real update id, so a budget burnt while the target was
 * unknown cannot block a later, identified target.
 */
export const RELOAD_TARGET_UNKNOWN_PREFIX = "running:";

export function shouldAllowAutoReload(
  guard: OtaReloadGuard | null,
  updateId: string,
  now = Date.now(),
  windowMs = GUARD_WINDOW_MS,
): boolean {
  if (!guard || guard.updateId !== updateId) return true;
  if (now - guard.firstAttemptAt > windowMs) return true;
  return guard.attempts < MAX_AUTO_RELOADS_PER_UPDATE;
}

/**
 * Identify the update a reload would actually launch.
 *
 * This must resolve from the DOWNLOADED (or at least the server-offered)
 * manifest rather than the running update. Keying the guard on the running
 * update makes every target look identical, so a budget exhausted trying to
 * launch one update silently blocks the next — including a freshly published
 * update issued specifically to recover the device.
 */
export function resolveReloadTargetId(opts: {
  downloadedUpdateId?: string | null;
  availableUpdateId?: string | null;
  runningUpdateId?: string | null;
}): string {
  const downloaded = opts.downloadedUpdateId?.trim();
  if (downloaded) return downloaded;
  const available = opts.availableUpdateId?.trim();
  if (available) return available;
  const running = opts.runningUpdateId?.trim();
  return `${RELOAD_TARGET_UNKNOWN_PREFIX}${running || "unknown"}`;
}

/** True when the target is a real update id rather than the unknown-target fallback. */
export function isIdentifiedReloadTarget(targetId: string): boolean {
  return !!targetId && !targetId.startsWith(RELOAD_TARGET_UNKNOWN_PREFIX);
}

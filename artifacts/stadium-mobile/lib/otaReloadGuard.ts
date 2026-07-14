/** Pure loop-guard logic — no expo-updates imports (testable in Node). */

export type OtaReloadGuard = {
  updateId: string;
  attempts: number;
  firstAttemptAt: number;
};

/** Max automatic reload attempts per update id before backing off (rollback loop protection). */
export const MAX_AUTO_RELOADS_PER_UPDATE = 2;
export const GUARD_WINDOW_MS = 60 * 60 * 1000;

export function shouldAllowAutoReload(
  guard: OtaReloadGuard | null,
  updateId: string,
  now = Date.now(),
): boolean {
  if (!guard || guard.updateId !== updateId) return true;
  if (now - guard.firstAttemptAt > GUARD_WINDOW_MS) return true;
  return guard.attempts < MAX_AUTO_RELOADS_PER_UPDATE;
}

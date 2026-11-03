/**
 * Per-build research-tester unlock for Coach college sims.
 *
 * Each Coach build registers its own context for the duration of the build.
 * Overlapping builds never save/restore a shared boolean (that races). When
 * overlapping contexts disagree, unlock fails closed. Contexts are removed on
 * completion, cancellation, timeout, and error.
 *
 * Set only from server-verified `researchTesterAccess`. Never read
 * EXPO_PUBLIC allowlists. Default locked.
 */

export type ResearchBuildContext = {
  readonly buildId: string;
  /** True only when this build was started with server-verified research access. */
  readonly unlocked: boolean;
};

let nextBuildId = 1;
const activeBuilds = new Map<string, ResearchBuildContext>();

/** Fixed disclaimer for research-tester Coach outputs. */
export const RESEARCH_NOT_VALIDATED_LABEL = "Research — not validated.";

function createBuildContext(unlocked: boolean): ResearchBuildContext {
  const buildId = `research-build-${nextBuildId++}`;
  return { buildId, unlocked: unlocked === true };
}

/**
 * Resolve unlock for the current call stack.
 * - No active builds → locked.
 * - Any locked build among active → fail closed (locked).
 * - Otherwise unlocked only when every active build is unlocked.
 */
export function isResearchTesterUnlockActive(): boolean {
  if (activeBuilds.size === 0) return false;
  let sawUnlocked = false;
  for (const ctx of activeBuilds.values()) {
    if (!ctx.unlocked) return false;
    sawUnlocked = true;
  }
  return sawUnlocked;
}

/** Active build ids — test/introspection only. */
export function researchTesterActiveBuildIds(): readonly string[] {
  return [...activeBuilds.keys()];
}

/** Run `fn` with a dedicated research-tester build context. */
export function runWithResearchTesterUnlock<T>(
  unlocked: boolean,
  fn: () => T,
): T {
  const ctx = createBuildContext(unlocked);
  activeBuilds.set(ctx.buildId, ctx);
  try {
    return fn();
  } finally {
    activeBuilds.delete(ctx.buildId);
  }
}

/**
 * Async build scope. Context is removed in `finally` so cancellation, timeout,
 * and thrown errors never leave unlock enabled.
 */
export async function runWithResearchTesterUnlockAsync<T>(
  unlocked: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = createBuildContext(unlocked);
  activeBuilds.set(ctx.buildId, ctx);
  try {
    return await fn();
  } finally {
    activeBuilds.delete(ctx.buildId);
  }
}

/** Test helper — force-clear all build contexts (sign-out / isolation). */
export function resetResearchTesterSessionsForTests(): void {
  activeBuilds.clear();
}

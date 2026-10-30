/**
 * Request-scoped research-tester unlock for Coach college sims.
 *
 * Set only from server-verified `researchTesterAccess` at the start of a
 * Coach build. Never read EXPO_PUBLIC allowlists. Default locked.
 */

let activeResearchTesterUnlock = false;

/** Run `fn` with research-tester college unlock active (or not). */
export function runWithResearchTesterUnlock<T>(
  unlocked: boolean,
  fn: () => T,
): T {
  const prev = activeResearchTesterUnlock;
  activeResearchTesterUnlock = unlocked === true;
  try {
    return fn();
  } finally {
    activeResearchTesterUnlock = prev;
  }
}

export async function runWithResearchTesterUnlockAsync<T>(
  unlocked: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = activeResearchTesterUnlock;
  activeResearchTesterUnlock = unlocked === true;
  try {
    return await fn();
  } finally {
    activeResearchTesterUnlock = prev;
  }
}

/** True only inside an active research-tester Coach build scope. */
export function isResearchTesterUnlockActive(): boolean {
  return activeResearchTesterUnlock === true;
}

/** Fixed disclaimer for research-tester Coach outputs. */
export const RESEARCH_NOT_VALIDATED_LABEL = "Research — not validated.";

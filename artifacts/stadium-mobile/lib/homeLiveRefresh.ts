export const HOME_LIVE_REFETCH_MS = 15_000;

/** Native resumes need an explicit scoreboard invalidation. */
export function shouldRefreshHomeScoreboard(appState: string): boolean {
  return appState === "active";
}

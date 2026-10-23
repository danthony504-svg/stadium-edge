/** Prop-pool load policy for greenfield Coach builds. */

/** A completed full-board pass stays complete even when few/no prices are posted.
 * Pool size cannot distinguish an unrequested board from an empty response.
 */
export function shouldSkipScannerPropExpand(propPoolSize: number, fullBoardAttempted = false): boolean {
  return fullBoardAttempted || propPoolSize >= 40;
}

/** Apply the existing college-prop exclusion before paying for event requests. */
export function propBoardGamesForScope<T extends { sport: string }>(
  games: T[],
  scope: { gameLinesOnly: boolean; allowNcaafPlayerProps: boolean },
): T[] {
  if (scope.gameLinesOnly) return [];
  return scope.allowNcaafPlayerProps ? games : games.filter((game) => game.sport !== "ncaaf");
}

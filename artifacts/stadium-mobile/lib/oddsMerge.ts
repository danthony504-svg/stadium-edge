/**
 * Pure odds-row merge helpers — kept free of PickCard/React so node:test can
 * cover the liveOdds spread SCAN_THREW regression.
 */

export type OddsMergeEntry = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  edge?: number | null;
  [key: string]: unknown;
};

export const oddsEntryKey = (e: OddsMergeEntry) =>
  `${e.game}|${e.market.toLowerCase()}|${e.pick}`;

/** Union odds rows; later sources win. Each source must be an array. */
export function mergeOddsEntries(...sources: OddsMergeEntry[][]): OddsMergeEntry[] {
  const map = new Map<string, OddsMergeEntry>();
  for (const list of sources) {
    // Guard: spreading RealOddsEntry[] into ...sources made `list` a single
    // entry object → TypeError "not iterable" → tryReachFullBoardScan(null) →
    // phone SCAN_THREW empty tickets.
    if (!Array.isArray(list)) continue;
    for (const e of list) map.set(oddsEntryKey(e), e);
  }
  return [...map.values()];
}

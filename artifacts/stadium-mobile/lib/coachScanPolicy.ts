// Coach full-board parlay scan policy — enforced in boardMarketScanner, ticket
// staging, and delivery gates. Never pad tickets with ungraded posted lines.

export const COACH_FULL_BOARD_SCAN_POLICY =
  "Scan every available market. Return all AI Recommended picks first. If fewer than the requested number qualify, continue scanning alternate lines, props, periods, innings, quarters, halves, and team totals until enough AI Recommended picks are found. Only if every posted market has been evaluated and there still aren't enough qualifying picks should the app return fewer legs. Never add filler picks just to reach the requested number.";

export const COACH_NO_FILLER_SHORTFALL =
  "Every posted market was scanned — these are every AI Recommended and qualifying alt pick on the board. No filler was added to reach your requested leg count.";

/** Honest edge copy on posted-line backfill legs — never show on board-scan tickets. */
export const FILLER_BACKFILL_EDGE_NOTE =
  "Added to round out your requested ticket size — this is a real posted line from tonight's board, not a separate model edge.";

export function isFillerBackfillPick(pick: { edge?: string | null }): boolean {
  return pick.edge === FILLER_BACKFILL_EDGE_NOTE;
}

export function stripFillerBackfillPicks<T extends { edge?: string | null }>(picks: T[]): T[] {
  return picks.filter((p) => !isFillerBackfillPick(p));
}

/** Never pad 3+ leg parlays with ungraded posted lines when a board scan applies. */
export function shouldAllowReachCountBackfill(opts: {
  fullBoardScanned?: boolean;
  reachBoardEligible?: boolean;
  legTarget?: number;
  isParlayBuild?: boolean;
}): boolean {
  if (opts.fullBoardScanned) return false;
  if (opts.reachBoardEligible) return false;
  if (opts.isParlayBuild && (opts.legTarget ?? 0) >= 3) return false;
  return true;
}

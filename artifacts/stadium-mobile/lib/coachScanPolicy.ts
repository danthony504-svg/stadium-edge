// Coach full-board parlay scan policy — enforced in boardMarketScanner, ticket
// staging, and delivery gates. Never pad tickets with ungraded posted lines.

export const COACH_FULL_BOARD_SCAN_POLICY =
  "Scan every available market. Return all AI Recommended picks first. If fewer than the requested number qualify, continue scanning alternate lines, props, periods, innings, quarters, halves, and team totals until enough AI Recommended picks are found. Only if every posted market has been evaluated and there still aren't enough qualifying picks should the app return fewer legs. Never add filler picks just to reach the requested number.";

/** User-facing fixed-leg ticket policy (3, 5, 6, 10, 15, …). */
export const COACH_FIXED_LEG_TICKET_POLICY =
  "Scan every posted market first. Fill with the highest-rated main lines. If the target is not reached, promote AI-approved alternate lines with positive EV, positive edge, grade C+ or higher, and confidence above the minimum threshold — continue until the requested leg count is reached or every qualifying alternate is exhausted. Never add ungraded or negative-EV filler.";

export const COACH_NO_FILLER_SHORTFALL =
  "Every posted market was scanned — these are every AI Recommended and qualifying alt pick on the board. No filler was added to reach your requested leg count.";

export const COACH_FIXED_LEG_SHORTFALL_LEAD =
  "Every qualifying market was evaluated across the live board — only this many AI-backed picks met the quality bar.";

/** Exhaustive alt-ladder policy — every posted rung scored; mains then alts per market. */
export const COACH_EXHAUSTIVE_MARKET_LADDER_POLICY =
  "For every game, evaluate every posted alternate spread, alternate total, alternate team total, alternate player prop, combo prop, and ladder prop. Score every line independently in the background before the app opens and while the app is open. If the primary line fails, automatically continue evaluating alternate versions until a qualifying line is found or every posted line in that ladder has been exhausted.";

/** Visible one-liner when a fixed-leg ask returns fewer than requested. */
export function buildFixedLegCountShortfallLead(requested: number, actual: number): string {
  if (actual >= requested) return "";
  return `You asked for **${requested}** legs — only **${actual}** cleared the AI quality bar after every posted market was scanned. No ungraded filler was added.`;
}

/** Fixed leg-count parlay (3, 5, 6, 10, 15, …) — full-board scan + staged alt promotion. */
export function isFixedLegCountParlay(requestedLegs: number): boolean {
  return requestedLegs >= 3;
}

/** Promote qualifying mains then alts to reach N — never round-out filler. */
export function shouldPromoteQualifyingAltsForFixedLegTicket(opts: {
  requestedLegs: number;
  isParlayBuild?: boolean;
  isAnalyze?: boolean;
  propsOnly?: boolean;
  explicitSingleGame?: boolean;
  oddsThreshold?: unknown;
  confidenceThreshold?: unknown;
  altSign?: unknown;
}): boolean {
  if (opts.isAnalyze || !opts.isParlayBuild) return false;
  if (!isFixedLegCountParlay(opts.requestedLegs)) return false;
  if (opts.propsOnly || opts.explicitSingleGame) return false;
  if (opts.oddsThreshold || opts.confidenceThreshold || opts.altSign) return false;
  return true;
}

/** Honest edge copy on posted-line backfill legs — never show on board-scan tickets. */
export const FILLER_BACKFILL_EDGE_NOTE =
  "Added to round out your requested ticket size — this is a real posted line from tonight's board, not a separate model edge.";

export function isFillerBackfillPick(pick: { edge?: string | null }): boolean {
  return pick.edge === FILLER_BACKFILL_EDGE_NOTE;
}

export function stripFillerBackfillPicks<T extends { edge?: string | null }>(picks: T[]): T[] {
  return picks.filter((p) => !isFillerBackfillPick(p));
}

/** Block assembleDeepParlay / finalizeDeepParlay / ungraded replenish on fixed-leg asks. */
export function shouldBlockUngradedParlayTopUp(opts: {
  promoteQualifyingAlts?: boolean;
  fullBoardScanned?: boolean;
  reachBoardEligible?: boolean;
}): boolean {
  if (opts.promoteQualifyingAlts) return true;
  if (opts.fullBoardScanned) return true;
  if (opts.reachBoardEligible) return true;
  return false;
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

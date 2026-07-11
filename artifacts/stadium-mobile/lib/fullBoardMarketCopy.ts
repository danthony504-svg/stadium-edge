// User-facing list of every market family the full-board parlay scan covers.

export const FULL_BOARD_MARKET_FAMILIES =
  "live markets, moneylines, spreads, alternate spreads, totals, alternate totals, team totals, race-to markets, first 5 innings, innings, first half, second half, first quarter, second quarter, third quarter, first period, second period, third period, player props, alternate player props, combo props, and any other sportsbook-posted markets";

export function fullBoardScanSuccessNote(totalScanned: number, pickCount: number): string {
  return `_Scanned every posted line on the board — ${FULL_BOARD_MARKET_FAMILIES} (**${totalScanned}** lines, 10k sim each, cross-book line shopping, correlation scoring, and historical learning applied). These **${pickCount}** are the highest-rated by win probability, implied probability, EV, edge, confidence, and AI grade._`;
}

export function fullBoardScanShortfallNote(
  totalScanned: number,
  totalQualified: number,
  pickCount: number,
): string {
  return `_Scanned the entire board — **${totalScanned}** posted lines across ${FULL_BOARD_MARKET_FAMILIES} (10k sim each, cross-book line shopping, correlation scoring, and historical learning applied). Only **${totalQualified}** met quality standards (positive EV/edge, grade ≥ C+, confidence ≥ 52%, sim hit > implied). Here are the top **${pickCount}** by EV, edge, confidence, and AI grade._`;
}

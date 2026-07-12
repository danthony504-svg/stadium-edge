// User-facing list of every market family the full-board parlay scan covers.

export type TicketStagingBreakdown = {
  mainQualified: number;
  altQualified: number;
  mainOnTicket: number;
  altOnTicket: number;
};

export const FULL_BOARD_MARKET_FAMILIES =
  "live markets, moneylines, spreads, alternate spreads, totals, alternate totals, team totals, race-to markets, first 5 innings, innings, first half, second half, first quarter, second quarter, third quarter, first period, second period, third period, player props, alternate player props, combo props, and any other sportsbook-posted markets";

export function fullBoardScanSuccessNote(totalScanned: number, pickCount: number): string {
  return `_Scanned every posted line on the board — ${FULL_BOARD_MARKET_FAMILIES} (**${totalScanned}** lines, 10k sim each, cross-book line shopping, correlation scoring, and historical learning applied). These **${pickCount}** are the highest-rated by win probability, implied probability, EV, edge, confidence, and AI grade._`;
}

export function fullBoardScanShortfallNote(
  totalScanned: number,
  totalQualified: number,
  pickCount: number,
  staging?: TicketStagingBreakdown,
): string {
  const staged =
    staging && (staging.mainOnTicket > 0 || staging.altOnTicket > 0)
      ? ` Filled with **${staging.mainOnTicket}** main pick${staging.mainOnTicket === 1 ? "" : "s"}${staging.altOnTicket > 0 ? ` and **${staging.altOnTicket}** alt pick${staging.altOnTicket === 1 ? "" : "s"} (labeled ALT PICK)` : ""}.`
      : "";
  return `_Scanned the entire board — **${totalScanned}** posted lines across ${FULL_BOARD_MARKET_FAMILIES} (10k sim each, cross-book line shopping, correlation scoring, and historical learning applied). **${staging?.mainQualified ?? totalQualified}** main lines and **${staging?.altQualified ?? 0}** alt/reach lines cleared their quality bars (main: sim + edge + EV + grade ≥ C+ + confidence ≥ 52%; alt: positive EV/edge, grade ≥ C+, confidence ≥ 50%; reach fill: grade ≥ C, confidence ≥ 48%).${staged} Here are the top **${pickCount}** by EV, edge, confidence, and AI grade._`;
}

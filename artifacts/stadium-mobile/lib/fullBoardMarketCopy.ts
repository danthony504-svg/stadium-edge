// User-facing list of every market family the full-board parlay scan covers.

import { COACH_NO_FILLER_SHORTFALL } from "./coachScanPolicy.ts";

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
      ? staging.altOnTicket > 0
        ? ` Filled with **${staging.mainOnTicket}** main pick${staging.mainOnTicket === 1 ? "" : "s"} and **${staging.altOnTicket}** alt pick${staging.altOnTicket === 1 ? "" : "s"} (labeled **ALT PICK**).`
        : ` **${staging.mainOnTicket}** main pick${staging.mainOnTicket === 1 ? "" : "s"} on the ticket.`
      : "";
  const altPool = staging?.altQualified ?? 0;
  const mainPool = staging?.mainQualified ?? totalQualified;
  if (staging && staging.altOnTicket > 0) {
    return `_Scanned the entire board — **${totalScanned}** posted lines across ${FULL_BOARD_MARKET_FAMILIES} (10k sim each, cross-book line shopping, correlation scoring, and historical learning applied). **${mainPool}** main lines and **${altPool}** alt lines cleared the quality bar — stepped to alternate rungs where mains ran out.${staged} These **${pickCount}** are the highest-rated sim-aligned legs by EV, edge, confidence, and AI grade. ${COACH_NO_FILLER_SHORTFALL}_`;
  }
  return `_Scanned the entire board — **${totalScanned}** posted lines across ${FULL_BOARD_MARKET_FAMILIES} (10k sim each, cross-book line shopping, correlation scoring, and historical learning applied). **${mainPool}** main lines and **${altPool}** alt lines cleared the quality bar (sim + positive edge + positive EV + grade ≥ C+ + confidence ≥ 52%).${staged} These **${pickCount}** are the top sim-aligned legs by EV, edge, confidence, and AI grade. ${COACH_NO_FILLER_SHORTFALL}_`;
}

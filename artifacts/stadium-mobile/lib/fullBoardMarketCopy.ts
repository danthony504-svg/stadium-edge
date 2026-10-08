// User-facing list of every market family the full-board parlay scan covers.

export type TicketStagingBreakdown = {
  mainQualified: number;
  altQualified: number;
  mainOnTicket: number;
  altOnTicket: number;
};

export const FULL_BOARD_MARKET_FAMILIES =
  "live markets, moneylines, spreads, alternate spreads, totals, alternate totals, team totals, race-to markets, first 5 innings, innings, first half, second half, first quarter, second quarter, third quarter, first period, second period, third period, player props, alternate player props, combo props, and any other sportsbook-posted markets";

/** Hidden in Coach chat — board scan still runs; pick cards are the surface. */
export function fullBoardScanSuccessNote(_totalScanned: number, _pickCount: number): string {
  return "";
}

import { COACH_NO_FILLER_SHORTFALL } from "./coachScanPolicy.ts";

/**
 * Shortfall chat note after a full-board (or props-only) scan.
 *
 * Copy MUST describe the final delivered ticket (`pickCount`), not intermediate
 * staging pools. Phone bug: "20 main + 7 alt cleared" / "Filled with 3 main and
 * 1 alt" / "These 7 are…" mixed pool counts, pre-fill staged counts, and final
 * length in one paragraph.
 *
 * Props/yards asks never sim moneylines/spreads/F5 — returning the full-board
 * essay there lied on phone (screenshot: props ask + "scanned … moneylines").
 * Empty string → `buildFinalCoachParlayNote` falls through to the honest
 * fixed-leg shortfall lead (same surface as hidden success notes).
 */
export function fullBoardScanShortfallNote(
  totalScanned: number,
  totalQualified: number,
  pickCount: number,
  staging?: TicketStagingBreakdown,
  opts?: { propsOnly?: boolean; requested?: number },
): string {
  if (opts?.propsOnly) return "";

  const requested = opts?.requested;
  const mainOn = staging?.mainOnTicket ?? 0;
  const altOn = staging?.altOnTicket ?? 0;
  // Only cite main/alt composition when it reconciles with the final ticket.
  const rolesMatchFinal = pickCount > 0 && mainOn + altOn === pickCount;
  const finalRoleDetail = rolesMatchFinal
    ? altOn > 0
      ? ` Ticket composition: ${mainOn} main pick${mainOn === 1 ? "" : "s"} and ${altOn} alt pick${altOn === 1 ? "" : "s"} (labeled ALT PICK).`
      : ` Ticket composition: ${mainOn} main pick${mainOn === 1 ? "" : "s"}.`
    : "";

  // Preferred path: requested known and short of target — lead with final length.
  if (requested != null && pickCount < requested) {
    const lead =
      pickCount <= 0
        ? `You asked for ${requested} legs. No qualified picks were available, so no filler was added.`
        : `You asked for ${requested} legs. ${pickCount} qualified picks were available, so no filler was added.`;
    const scanCtx = `_Evaluated ${totalScanned} posted lines across ${FULL_BOARD_MARKET_FAMILIES}. Supported markets use shared game/prop Monte Carlo (typically 10k draws per game or capped prop batch), cross-book line shopping, correlation scoring, and historical learning. ${COACH_NO_FILLER_SHORTFALL}_`;
    void totalQualified;
    return `${lead}${finalRoleDetail}\n\n${scanCtx}`;
  }

  // Fallback when requested is unknown: still never mix pool sizes with a
  // mismatched "Filled with" / "These N" trio.
  const composed = rolesMatchFinal
    ? altOn > 0
      ? ` Filled with ${mainOn} main pick${mainOn === 1 ? "" : "s"} and ${altOn} alt pick${altOn === 1 ? "" : "s"} (labeled ALT PICK).`
      : ` ${mainOn} main pick${mainOn === 1 ? "" : "s"} on the ticket.`
    : "";
  void totalQualified;
  return `_Evaluated ${totalScanned} posted lines across ${FULL_BOARD_MARKET_FAMILIES}. Supported markets use shared game/prop Monte Carlo (typically 10k draws per game or capped prop batch), cross-book line shopping, correlation scoring, and historical learning.${composed} These ${pickCount} are the top sim-aligned legs by EV, edge, confidence, and AI grade. ${COACH_NO_FILLER_SHORTFALL}_`;
}

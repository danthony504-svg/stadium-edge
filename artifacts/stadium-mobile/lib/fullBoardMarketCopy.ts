// User-facing list of every market family the full-board parlay scan covers.
// Long laundry-list blurbs are kept off the Coach chat — detail lives on the
// Coach Scan Diagnostics screen. Scan / scoring / delivery are unchanged.

export type TicketStagingBreakdown = {
  mainQualified: number;
  altQualified: number;
  mainOnTicket: number;
  altOnTicket: number;
};

export const FULL_BOARD_MARKET_FAMILIES =
  "live markets, moneylines, spreads, alternate spreads, totals, alternate totals, team totals, race-to markets, first 5 innings, innings, first half, second half, first quarter, second quarter, third quarter, first period, second period, third period, player props, alternate player props, combo props, and any other sportsbook-posted markets";

/**
 * True when text is the old long "Scanned every posted line…" Coach blurb.
 * Used to hide legacy notes in the chat UI without touching scan logic.
 */
export function isCoachBoardScanBlurb(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return (
    /scanned every posted line on the board/i.test(t) ||
    /scanned the entire board/i.test(t) ||
    (t.includes(FULL_BOARD_MARKET_FAMILIES) && /10k sim each/i.test(t))
  );
}

/**
 * Success path: no long essay in chat. Diagnostics screen has the funnel.
 * Returning "" leaves pick cards as the only Coach surface after a full ticket.
 */
export function fullBoardScanSuccessNote(_totalScanned: number, _pickCount: number): string {
  return "";
}

import { COACH_NO_FILLER_SHORTFALL } from "./coachScanPolicy.ts";

/** Shortfall: keep honest shortfall copy only — no market-family laundry list. */
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
    return `Board scan found **${totalScanned}** posted lines; **${mainPool}** main and **${altPool}** alt cleared quality — stepped to alts where mains ran out.${staged} Showing **${pickCount}**. ${COACH_NO_FILLER_SHORTFALL}`;
  }
  return `Board scan found **${totalScanned}** posted lines; **${mainPool}** main and **${altPool}** alt cleared quality.${staged} Showing **${pickCount}**. ${COACH_NO_FILLER_SHORTFALL}`;
}

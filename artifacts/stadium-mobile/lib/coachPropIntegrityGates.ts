/**
 * Fail-closed prop integrity gates for Coach tickets:
 * - unsupported QB rush Over ≤ 0.5 (kneel/settlement)
 * - yardage props need ≥5 valid participating games
 */

import type { ParsedPick } from "../components/PickCard.tsx";

/** Ticket seating floor for yardage props (MC may still run at n≥3). */
export const YARDS_TICKET_MIN_PARTICIPATING_GAMES = 5;

const FOOTBALL_SPORTS = new Set(["nfl", "ncaaf"]);

function marketKeyOf(pick: {
  propMarketKey?: string | null;
  market?: string | null;
}): string {
  return String(pick.propMarketKey ?? pick.market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ")
    .trim();
}

export function isYardagePropMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ");
  if (!m) return false;
  if (/pass\s*yds|passing\s*yards|pass\s*yards/.test(m)) return true;
  if (/rush\s*yds|rushing\s*yards|rush\s*yards/.test(m)) return true;
  if (/reception\s*yds|receiving\s*yards|rec\s*yds|receiving\s*yds/.test(m)) return true;
  return false;
}

export function isRushYardsPropMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ");
  return /rush\s*yds|rushing\s*yards|rush\s*yards/.test(m);
}

export function isConfirmedQbPosition(position: string | null | undefined): boolean {
  const p = String(position ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return p === "QB";
}

/**
 * Block only confirmed-QB rushing Over lines at ≤0.5 until kneel settlement
 * is modeled. RB/WR and higher QB rush lines remain eligible.
 */
export function isUnsupportedQbRushOverHalf(pick: {
  sport?: string | null;
  isProp?: boolean;
  propMarketKey?: string | null;
  market?: string | null;
  propSide?: string | null;
  propLine?: number | null;
  position?: string | null;
}): boolean {
  if (!pick.isProp) return false;
  const sport = String(pick.sport ?? "").toLowerCase();
  if (!FOOTBALL_SPORTS.has(sport)) return false;
  if (!isRushYardsPropMarket(pick.propMarketKey ?? pick.market)) return false;
  if (String(pick.propSide ?? "").toLowerCase() !== "over") return false;
  if (pick.propLine == null || !Number.isFinite(pick.propLine) || pick.propLine > 0.5) {
    return false;
  }
  // Unknown position: do not blanket-block (protects RBs missing stamp).
  if (!isConfirmedQbPosition(pick.position)) return false;
  return true;
}

/**
 * Yardage ticket sample gate. Uses server `validParticipatingGames` when present;
 * else falls back to `sampleGames`. Five games alone is not a reliability proof —
 * callers still run EV/edge/mapping gates.
 */
export function yardageTicketSampleFails(pick: {
  isProp?: boolean;
  propMarketKey?: string | null;
  market?: string | null;
  validParticipatingGames?: number | null;
  sampleGames?: number | null;
}): boolean {
  if (!pick.isProp) return false;
  if (!isYardagePropMarket(pick.propMarketKey ?? pick.market)) return false;
  const n =
    pick.validParticipatingGames != null && Number.isFinite(pick.validParticipatingGames)
      ? Number(pick.validParticipatingGames)
      : pick.sampleGames != null && Number.isFinite(pick.sampleGames)
        ? Number(pick.sampleGames)
        : 0;
  return n < YARDS_TICKET_MIN_PARTICIPATING_GAMES;
}

export function propIntegrityBlocksCandidate(pick: ParsedPick & {
  position?: string | null;
  validParticipatingGames?: number | null;
  sampleGames?: number | null;
}): { blocked: boolean; reason: string | null } {
  if (isUnsupportedQbRushOverHalf(pick)) {
    return {
      blocked: true,
      reason: "unsupported_qb_rush_over_half_settlement",
    };
  }
  if (yardageTicketSampleFails(pick)) {
    return {
      blocked: true,
      reason: "insufficient_yardage_participating_sample",
    };
  }
  return { blocked: false, reason: null };
}

/** Exported for tests — market key normalization. */
export function coachPropMarketKeyForIntegrity(pick: {
  propMarketKey?: string | null;
  market?: string | null;
}): string {
  return marketKeyOf(pick);
}

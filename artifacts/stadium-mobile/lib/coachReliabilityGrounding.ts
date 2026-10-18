/**
 * Observe-only grounding checks for Coach reliability reporting.
 * Does not change selection / grading / simulation / UI — classification only.
 */

import {
  normalizeTeamAbbr,
  resolvePropPlayerSides,
  teamAbbrMatchesTeamName,
} from "./resolvePropPlayerSides.ts";

/** Minimal pick shape used for reliability grounding (no Coach behavior change). */
export type CoachReliabilityGroundingPick = {
  game?: string | null;
  teamAbbr?: string | null;
  player?: string | null;
  isProp?: boolean | null;
  propMarketKey?: string | null;
  athleteId?: string | null;
  market?: string | null;
  /** When present, prefer sport-appropriate nick maps (mlb vs nfl CLE/TB). */
  sport?: string | null;
};

export type ReturnedPicksGroundingResult = {
  /** True when at least one player prop fails player/team ↔ game grounding. */
  hasMismatch: boolean;
  /** First mismatched game label, else first pick game, else null. */
  affectedGame: string | null;
  mismatchCount: number;
};

/** Odds-style abbr → tokens that appear in ESPN full names (NFL + common). */
const ABBR_NAME_TOKENS: Record<string, string[]> = {
  ARI: ["arizona", "cardinals"],
  ATL: ["atlanta", "falcons"],
  BAL: ["baltimore", "ravens"],
  BUF: ["buffalo", "bills"],
  CAR: ["carolina", "panthers"],
  CHI: ["chicago", "bears"],
  CIN: ["cincinnati", "bengals"],
  CLE: ["cleveland", "browns"],
  DAL: ["dallas", "cowboys"],
  DEN: ["denver", "broncos"],
  DET: ["detroit", "lions"],
  GB: ["packers", "greenbay"],
  HOU: ["houston", "texans"],
  IND: ["indianapolis", "colts"],
  JAX: ["jacksonville", "jaguars"],
  JAC: ["jacksonville", "jaguars"],
  KC: ["kansascity", "chiefs"],
  LAC: ["chargers"],
  LAR: ["rams"],
  LV: ["lasvegas", "raiders"],
  MIA: ["miami", "dolphins"],
  MIN: ["minnesota", "vikings"],
  NE: ["newengland", "patriots"],
  NO: ["neworleans", "saints"],
  NYG: ["giants"],
  NYJ: ["jets"],
  PHI: ["philadelphia", "eagles"],
  PIT: ["pittsburgh", "steelers"],
  SEA: ["seattle", "seahawks"],
  SF: ["sanfrancisco", "49ers", "niners"],
  TB: ["tampabay", "buccaneers", "bucs"],
  TEN: ["tennessee", "titans"],
  WAS: ["washington", "commanders"],
  WSH: ["washington", "commanders"],
};

function normAbbr(s: string): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function compactTeam(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function abbrMatchesTeamName(
  abbr: string,
  teamName: string,
  sport?: string | null,
): boolean {
  const a = normalizeTeamAbbr(abbr) || normAbbr(abbr);
  const compact = compactTeam(teamName);
  if (!a || !compact) return false;
  // Long abbrs can substring-match (e.g. ARI ⊂ arizonacardinals).
  if (a.length >= 3 && compact.includes(a.toLowerCase())) return true;

  const sportKey = String(sport ?? "").toLowerCase();
  // MLB (and unspecified mixed boards that already carry MLB nick labels like
  // "Rays @ Guardians"): use the shared MLB nick map first so TB/CLE/TBR do
  // not fall through to NFL buccaneers/browns-only tokens.
  if (!sportKey || sportKey === "mlb" || sportKey === "baseball") {
    if (teamAbbrMatchesTeamName(a, teamName)) return true;
    if (sportKey === "mlb" || sportKey === "baseball") return false;
  }

  const tokens = ABBR_NAME_TOKENS[a];
  if (!tokens?.length) return false;
  return tokens.some((t) => t.length >= 4 && compact.includes(t));
}

function isLikelyPlayerProp(pick: CoachReliabilityGroundingPick): boolean {
  if (pick.isProp === true) return true;
  if (pick.propMarketKey && String(pick.propMarketKey).trim()) return true;
  if (pick.athleteId && String(pick.athleteId).trim()) return true;
  // Bare `player` without prop markers is not enough — game-line enrichment
  // sometimes copies a team display name into player and must not trip grounding.
  const m = String(pick.market ?? "").toLowerCase();
  // Player markets commonly include these tokens; game ML/spread/total do not.
  if (
    pick.player &&
    String(pick.player).trim() &&
    /\b(pass|rush|receiv|yards|td|touchdown|reception|completion|interception|sack|tackle|points|rebounds|assists|threes|strikeout|home\s*run|hits|stolen)\b/.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Player prop whose known teamAbbr does not resolve onto either side of a
 * confidently parsed `Away @ Home` label.
 *
 * Unknown / incomplete metadata → false (not a confirmed mismatch):
 * - missing/empty teamAbbr
 * - missing/empty game
 * - unparseable / non-standard game (not exactly two non-empty sides)
 * - ambiguous match to both sides
 */
export function pickHasPlayerGameGroundingMismatch(
  pick: CoachReliabilityGroundingPick,
): boolean {
  if (!isLikelyPlayerProp(pick)) return false;

  const ab = normalizeTeamAbbr(pick.teamAbbr);
  if (!ab) return false; // unknown team identity

  const game = String(pick.game ?? "").trim();
  if (!game) return false; // unknown game

  const parts = game.split(/\s+@\s+/);
  if (parts.length !== 2) return false; // unparseable / non-standard
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  if (!away || !home) return false;

  // Prefer existing side resolver (MLB / soft abbrs + aliases), then
  // sport-aware token map (MLB nicknames before NFL bucs/browns).
  const sides = resolvePropPlayerSides({
    awayName: away,
    homeName: home,
    teamAbbr: ab,
  });
  if (sides.teamName) return false;

  const sport = pick.sport;
  const awayHit = abbrMatchesTeamName(ab, away, sport);
  const homeHit = abbrMatchesTeamName(ab, home, sport);
  if (awayHit && !homeHit) return false;
  if (homeHit && !awayHit) return false;
  if (awayHit && homeHit) return false; // ambiguous → unknown, not mismatch
  // Confident parse + known team + matches neither side → confirmed mismatch.
  return true;
}

/** Prefer first mismatched game; else first non-empty game label on the ticket. */
export function affectedGameFromPicks(
  picks: readonly CoachReliabilityGroundingPick[] | null | undefined,
): string | null {
  if (!picks?.length) return null;
  for (const p of picks) {
    if (pickHasPlayerGameGroundingMismatch(p)) {
      const g = String(p.game ?? "").trim();
      if (g) return g.slice(0, 120);
    }
  }
  for (const p of picks) {
    const g = String(p.game ?? "").trim();
    if (g) return g.slice(0, 120);
  }
  return null;
}

export function evaluateReturnedPicksGrounding(
  picks: readonly CoachReliabilityGroundingPick[] | null | undefined,
): ReturnedPicksGroundingResult {
  if (!picks?.length) {
    return { hasMismatch: false, affectedGame: null, mismatchCount: 0 };
  }
  let mismatchCount = 0;
  let firstMismatchGame: string | null = null;
  for (const p of picks) {
    if (pickHasPlayerGameGroundingMismatch(p)) {
      mismatchCount += 1;
      if (!firstMismatchGame) {
        const g = String(p.game ?? "").trim();
        if (g) firstMismatchGame = g.slice(0, 120);
      }
    }
  }
  return {
    hasMismatch: mismatchCount > 0,
    affectedGame: firstMismatchGame ?? affectedGameFromPicks(picks),
    mismatchCount,
  };
}

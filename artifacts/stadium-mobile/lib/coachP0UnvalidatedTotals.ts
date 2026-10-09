// P0 emergency fail-closed for unvalidated scoring sims.
// Production nfl-drive / nhl-shift engines inflate or collapse scoring means;
// periodScoresForDraw also breaks FG = 1H + 2H. Until P1 recalibration lands,
// block simulation-derived grades for affected markets and hard-stop same-team
// team-total stacks. Does not invent odds, probs, or replacement sims.
//
// NCAAF game lines (spread / ML / alt / period sides) are also fail-closed:
// nfl-drive TD/FG rate caps make cover probs insensitive to offense/QB shocks,
// and matchup defense packs never enter score draws. Player props stay open.
//
// Sport aliases (cfb → ncaaf) are normalized before the gate. Missing sport is
// resolved only from trusted provider/event fields — never guessed from team
// names. Game-line identity comes from market keys, not the isProp flag.
//
// Standalone (no import from simMarketSupport) to avoid circular deps with
// assessSimMarketIntegrity.

/** Sports whose team-scoring engines are unvalidated for totals (P0). */
export const P0_UNVALIDATED_SCORING_SPORTS = new Set(["nfl", "ncaaf", "nhl"]);

/**
 * FG game totals that settle from the same unvalidated team-scoring engines.
 * NFL/NCAAF: inflated nfl-drive distribution.
 * NHL: nhl-shift applies (1−save%) on top of already-realized goal means, so
 * FG totals (not only team/period) are unsafe — fail closed too.
 */
export const P0_UNVALIDATED_FG_GAME_TOTAL_SPORTS = new Set(["nfl", "ncaaf", "nhl"]);

/**
 * NCAAF only — full-game and period game-side markets that settle from
 * unvalidated nfl-drive score draws. NFL game lines remain open for now;
 * NCAAF props are untouched.
 */
export const P0_UNVALIDATED_NCAAF_GAME_LINE_SPORTS = new Set(["ncaaf"]);

/** College-football aliases that must canonicalize to ncaaf before P0. */
const NCAAF_SPORT_ALIASES = new Set([
  "ncaaf",
  "cfb",
  "college-football",
  "college_football",
  "collegefootball",
  "ncaafb",
  "ncaa-football",
  "ncaa_football",
]);

export const P0_UNVALIDATED_TOTAL_REASON =
  "unvalidated_period_or_team_total_calibration";

export const P0_UNVALIDATED_NCAAF_GAME_LINE_REASON =
  "unvalidated_ncaaf_game_line_simulation";

/** Game-line with no trusted sport — fail closed (do not invent NCAAF/NFL). */
export const P0_UNVALIDATED_UNKNOWN_SPORT_GAME_LINE_REASON =
  "unvalidated_unknown_sport_game_line";

export type CoachSportResolveInput = {
  sport?: string | null;
  /** Trusted Odds API / event sport when pick.sport is missing. */
  providerSport?: string | null;
  /** Trusted event metadata sport (same authority as provider). */
  eventSport?: string | null;
};

/**
 * Canonical sport id for Coach gates. College-football aliases → ncaaf.
 * Does not invent a sport from team names or market text.
 */
export function canonicalizeCoachSport(sport?: string | null): string {
  const s = String(sport ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  if (!s) return "";
  if (NCAAF_SPORT_ALIASES.has(s)) return "ncaaf";
  if (s === "cbb" || s === "college-basketball" || s === "college_basketball") {
    return "ncaab";
  }
  return s;
}

/**
 * Resolve sport from the pick and trusted provider/event metadata only.
 * Order: sport → providerSport → eventSport. Empty when still unknown.
 */
export function resolveCoachPickSport(pick: CoachSportResolveInput): string {
  return (
    canonicalizeCoachSport(pick.sport) ||
    canonicalizeCoachSport(pick.providerSport) ||
    canonicalizeCoachSport(pick.eventSport) ||
    ""
  );
}

/** Lightweight period detect — mirrors parseMarketPeriod for totals only. */
function marketPeriodIsFullGame(market: string): boolean {
  const m = market.toLowerCase();
  if (/\bq[1-4]\b|first quarter|1st quarter|second quarter|2nd quarter|third quarter|3rd quarter|fourth quarter|4th quarter/.test(m)) {
    return false;
  }
  if (/\b1h\b|\b2h\b|h1|h2|first half|1st half|second half|2nd half/.test(m)) {
    return false;
  }
  if (/\bf5\b|first 5|1st 5|five innings|1st inning|first inning/.test(m)) {
    return false;
  }
  if (/\b1p\b|\b2p\b|\b3p\b|first period|1st period|second period|2nd period|third period|3rd period/.test(m)) {
    return false;
  }
  if (/_(q[1-4]|h[12]|p[123])\b/i.test(m)) return false;
  return true;
}

export function isTeamTotalMarket(market: string | null | undefined): boolean {
  return /team total/i.test(String(market ?? ""));
}

/**
 * Posted game total / alt total — not team total.
 * Market identity only — ignore isProp (a mis-tagged Total must not clear P0).
 */
export function isGameTotalMarket(
  market: string | null | undefined,
  _isProp?: boolean,
): boolean {
  const m = String(market ?? "");
  if (!m || isTeamTotalMarket(m)) return false;
  return /\btotals?\b|alt total|o\/u/i.test(m);
}

/**
 * Team game-side markets (spread / ML / run line / puck line).
 * Market / Odds API key identity only — isProp must NOT clear this.
 * Includes period-suffixed and underscore keys (spreads_q2, h2h_h1).
 */
export function isGameLineSideMarket(
  market: string | null | undefined,
  _isProp?: boolean,
): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!m || isTeamTotalMarket(m) || isGameTotalMarket(m)) return false;
  // Avoid matching prop labels that merely contain "ml" as a substring of a word.
  if (/moneyline|\bh2h\b|(?:^|[\s/])ml(?:$|[\s/])/.test(m)) return true;
  if (/spread|run line|puck line|alt spread/.test(m)) return true;
  return false;
}

/** True when market identity is a player-prop family (not a team game line/total). */
export function isPlayerPropMarketIdentity(
  market: string | null | undefined,
  opts?: { propMarketKey?: string | null },
): boolean {
  const key = String(opts?.propMarketKey ?? "").toLowerCase();
  if (key.startsWith("player_") || key.startsWith("batter_") || key.startsWith("pitcher_")) {
    return true;
  }
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .trim();
  if (!m) return false;
  if (isGameLineSideMarket(m) || isTeamTotalMarket(m) || isGameTotalMarket(m)) return false;
  if (/^player[\s_]|yards|receptions|rushing|passing|receiving|strikeouts|points\+|\btd\b|touchdown|assists|rebounds|goals|saves|shots/.test(m)) {
    return true;
  }
  return false;
}

export type P0PickInput = CoachSportResolveInput & {
  market?: string | null;
  isProp?: boolean;
  propMarketKey?: string | null;
};

/**
 * True when this pick must not receive a simulation-derived grade under P0 totals.
 * Market identity wins over isProp.
 */
export function isP0UnvalidatedSimTotalMarket(pick: P0PickInput): boolean {
  const sport = resolveCoachPickSport(pick);
  const market = String(pick.market ?? "");
  if (!market) return false;
  // Verified player-prop identity is never a team/FG total.
  if (isPlayerPropMarketIdentity(market, { propMarketKey: pick.propMarketKey })) {
    return false;
  }

  const fullGame = marketPeriodIsFullGame(market);
  const teamTotal = isTeamTotalMarket(market);
  const gameTotal = isGameTotalMarket(market);

  if (!sport) {
    // Unknown sport + total market → fail closed (do not invent nfl/ncaaf/nhl).
    return teamTotal || gameTotal;
  }

  if (teamTotal && P0_UNVALIDATED_SCORING_SPORTS.has(sport)) return true;
  if (gameTotal && !fullGame && P0_UNVALIDATED_SCORING_SPORTS.has(sport)) {
    return true;
  }
  if (gameTotal && fullGame && P0_UNVALIDATED_FG_GAME_TOTAL_SPORTS.has(sport)) {
    return true;
  }
  return false;
}

/**
 * True when NCAAF (incl. cfb alias) spread/ML must not receive a sim-derived grade.
 * Also true for game-line markets with unknown sport (fail closed).
 * isProp does not clear a game-line market identity.
 */
export function isP0UnvalidatedNcaafGameLineMarket(pick: P0PickInput): boolean {
  const market = String(pick.market ?? "");
  if (!market) return false;
  if (isPlayerPropMarketIdentity(market, { propMarketKey: pick.propMarketKey })) {
    return false;
  }
  if (!isGameLineSideMarket(market)) return false;

  const sport = resolveCoachPickSport(pick);
  if (!sport) return true; // unknown sport + game line → fail closed
  return P0_UNVALIDATED_NCAAF_GAME_LINE_SPORTS.has(sport);
}

export function p0UnvalidatedSimTotalDecision(
  pick: P0PickInput,
): { accept: false; reason: string } | null {
  if (!isP0UnvalidatedSimTotalMarket(pick)) return null;
  return { accept: false, reason: P0_UNVALIDATED_TOTAL_REASON };
}

export function p0UnvalidatedNcaafGameLineDecision(
  pick: P0PickInput,
): { accept: false; reason: string } | null {
  if (!isP0UnvalidatedNcaafGameLineMarket(pick)) return null;
  const sport = resolveCoachPickSport(pick);
  if (!sport) {
    return { accept: false, reason: P0_UNVALIDATED_UNKNOWN_SPORT_GAME_LINE_REASON };
  }
  return { accept: false, reason: P0_UNVALIDATED_NCAAF_GAME_LINE_REASON };
}

/** Combined P0 reject for totals + unvalidated NCAAF/unknown-sport game lines. */
export function p0UnvalidatedSimDecision(
  pick: P0PickInput,
): { accept: false; reason: string } | null {
  return p0UnvalidatedSimTotalDecision(pick) ?? p0UnvalidatedNcaafGameLineDecision(pick);
}

function teamNickFromTotalPick(pickText: string): string {
  const tokens = String(pickText ?? "")
    .toLowerCase()
    .replace(/\b(over|under|o|u)\b/g, " ")
    .replace(/[+-]?\d+(?:\.\d+)?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens[tokens.length - 1] ?? "";
}

const normGame = (g: string) =>
  String(g ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type StackPick = {
  game: string;
  market: string;
  pick: string;
  isProp?: boolean;
};

/**
 * Hard block: at most one team-total leg per team per game (any period/alt).
 * Applies to all sports — nested FG/1H/2H same-team stacks are unsafe without
 * joint period simulation.
 */
export function wouldStackSameTeamTeamTotals(
  candidate: StackPick,
  ticket: readonly StackPick[],
): boolean {
  if (!isTeamTotalMarket(candidate.market)) return false;
  // Market identity: mis-tagged isProp must not allow stacking team totals.
  const candGame = normGame(candidate.game);
  const candNick = teamNickFromTotalPick(candidate.pick);
  if (!candGame || !candNick) return false;

  return ticket.some((leg) => {
    if (!isTeamTotalMarket(leg.market)) return false;
    if (normGame(leg.game) !== candGame) return false;
    const nick = teamNickFromTotalPick(leg.pick);
    return !!nick && nick === candNick;
  });
}

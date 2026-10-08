// P0 emergency fail-closed for unvalidated team-total / period-total sims.
// Production nfl-drive / nhl-shift engines inflate or collapse scoring means;
// periodScoresForDraw also breaks FG = 1H + 2H. Until P1 recalibration lands,
// block simulation-derived grades for affected markets and hard-stop same-team
// team-total stacks. Does not invent odds, probs, or replacement sims.
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

export const P0_UNVALIDATED_TOTAL_REASON =
  "unvalidated_period_or_team_total_calibration";

function sportKey(sport?: string | null): string {
  return String(sport ?? "")
    .toLowerCase()
    .trim();
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

/** Posted game total / alt total — not team total, not props. */
export function isGameTotalMarket(
  market: string | null | undefined,
  isProp?: boolean,
): boolean {
  if (isProp) return false;
  const m = String(market ?? "");
  if (!m || isTeamTotalMarket(m)) return false;
  return /\btotals?\b|alt total|o\/u/i.test(m);
}

/**
 * True when this pick must not receive a simulation-derived grade under P0.
 * Player props, spreads, moneylines, and other non-total markets are untouched.
 */
export function isP0UnvalidatedSimTotalMarket(pick: {
  market?: string | null;
  sport?: string | null;
  isProp?: boolean;
}): boolean {
  if (pick.isProp) return false;
  const sport = sportKey(pick.sport);
  const market = String(pick.market ?? "");
  if (!market) return false;

  const fullGame = marketPeriodIsFullGame(market);
  const teamTotal = isTeamTotalMarket(market);
  const gameTotal = isGameTotalMarket(market, pick.isProp);

  if (teamTotal && P0_UNVALIDATED_SCORING_SPORTS.has(sport)) return true;
  if (gameTotal && !fullGame && P0_UNVALIDATED_SCORING_SPORTS.has(sport)) {
    return true;
  }
  if (gameTotal && fullGame && P0_UNVALIDATED_FG_GAME_TOTAL_SPORTS.has(sport)) {
    return true;
  }
  return false;
}

export function p0UnvalidatedSimTotalDecision(pick: {
  market?: string | null;
  sport?: string | null;
  isProp?: boolean;
}): { accept: false; reason: string } | null {
  if (!isP0UnvalidatedSimTotalMarket(pick)) return null;
  return { accept: false, reason: P0_UNVALIDATED_TOTAL_REASON };
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
  if (candidate.isProp || !isTeamTotalMarket(candidate.market)) return false;
  const candGame = normGame(candidate.game);
  const candNick = teamNickFromTotalPick(candidate.pick);
  if (!candGame || !candNick) return false;

  return ticket.some((leg) => {
    if (leg.isProp || !isTeamTotalMarket(leg.market)) return false;
    if (normGame(leg.game) !== candGame) return false;
    const nick = teamNickFromTotalPick(leg.pick);
    return !!nick && nick === candNick;
  });
}

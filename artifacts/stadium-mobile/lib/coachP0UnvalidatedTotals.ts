// P0 emergency fail-closed for unvalidated scoring sims.
// Production nfl-drive / nhl-shift engines inflate or collapse scoring means;
// periodScoresForDraw also breaks FG = 1H + 2H. Until P1 recalibration lands,
// block simulation-derived grades for affected markets and hard-stop same-team
// team-total stacks. Does not invent odds, probs, or replacement sims.
//
// NCAAF game lines stay fail-closed per market family (moneyline / spreads /
// totals / alts). P3: a cleared market must not unlock another; a failed market
// must not invalidate another. Legacy NCAAF_GAME_LINE_SIM_VALIDATED stays false
// until full product restore. Player props stay open either way.
//
// Sport aliases (cfb → ncaaf) are normalized before the gate. Missing sport is
// resolved only from trusted provider/event fields — never guessed from team
// names. Game-line identity comes from market keys, not the isProp flag.
//
// Standalone (no import from simMarketSupport) to avoid circular deps with
// assessSimMarketIntegrity.

/**
 * Legacy master — flip only after full product restore + human E6.
 * Prefer per-market NCAAF_MARKET_SIM_VALIDATED. Default false keeps P0 armed.
 */
export const NCAAF_GAME_LINE_SIM_VALIDATED = false;

/** Per-market product unlocks (P3 independence). All false until E6 per market. */
export type NcaafMarketFamily = "moneyline" | "spreads" | "totals" | "alts";

export const NCAAF_MARKET_SIM_VALIDATED: Readonly<
  Record<NcaafMarketFamily, boolean>
> = {
  moneyline: false,
  spreads: false,
  totals: false,
  alts: false,
};

/** Digest-only policy reason — not a scan/qualification/fulfillment miss. */
export const BLOCKED_UNVALIDATED_MARKET_REASON = "blocked_unvalidated_market";

/**
 * Research-only unlock for isolated Coach delivery exercises.
 * Requires BOTH env vars; never set in product/OTA builds.
 * Optional NCAAF_ISOLATED_COACH_MARKETS=moneyline,spreads (comma) limits families.
 * Does not change NCAAF_GAME_LINE_SIM_VALIDATED / NCAAF_MARKET_SIM_VALIDATED.
 */
export function ncaafIsolatedResearchUnlockActive(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  return (
    process.env.NCAAF_ISOLATED_COACH_UNLOCK === "1" &&
    process.env.NCAAF_ISOLATED_COACH_UNLOCK_ACK === "research-only-not-product"
  );
}

/** Research unlock market allow-list; empty/missing → all families (research only). */
export function ncaafIsolatedResearchMarkets(): Set<NcaafMarketFamily> | null {
  if (!ncaafIsolatedResearchUnlockActive()) return null;
  const raw = String(process.env.NCAAF_ISOLATED_COACH_MARKETS ?? "")
    .toLowerCase()
    .trim();
  if (!raw) return null;
  const out = new Set<NcaafMarketFamily>();
  for (const part of raw.split(/[,\s]+/)) {
    if (
      part === "moneyline" ||
      part === "spreads" ||
      part === "totals" ||
      part === "alts"
    ) {
      out.add(part);
    }
  }
  return out.size ? out : null;
}

export function isNcaafMarketProductValidated(
  family: NcaafMarketFamily,
): boolean {
  return NCAAF_MARKET_SIM_VALIDATED[family] === true;
}

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
 * nfl-drive score draws. Cleared only when NCAAF_GAME_LINE_SIM_VALIDATED.
 * NFL game lines remain open for now; NCAAF props are untouched.
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

/**
 * Quarters, halves, periods, and innings are a share of the full-game draw
 * (flat fraction or ESPN period averages). distributionForQuery reads that
 * same full-game series. Neither path is a period simulation, and a posted
 * price is not a validity check. Naming the period does not clear this gate.
 */
export const P0_UNVALIDATED_PERIOD_DECOMPOSITION_REASON =
  "unvalidated_period_full_game_decomposition";

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

/**
 * Lightweight period detect — same non-fg scopes as parseMarketPeriod.
 * Standalone so this module does not import simMarketSupport.
 * Odds API keys (`spreads_q3`, `totals_1st_5_innings`) are normalized first.
 * Any numbered inning is a period even when the sim has no scope for it, so
 * it cannot grade as a full-game side.
 */
function marketPeriodIsFullGame(market: string): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!m) return true;
  if (
    /\bq[1-4]\b|first quarter|1st quarter|second quarter|2nd quarter|third quarter|3rd quarter|fourth quarter|4th quarter/.test(
      m,
    )
  ) {
    return false;
  }
  if (/\b(?:1h|h1|2h|h2)\b|first half|1st half|second half|2nd half/.test(m)) {
    return false;
  }
  if (/\bf5\b|first 5|1st 5|five innings|first five innings/.test(m)) {
    return false;
  }
  if (/\b1st 1 innings?\b|\b1st inning\b|first inning/.test(m)) {
    return false;
  }
  if (
    /\b(?:2nd|3rd|4th|5th|6th|7th|8th|9th|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\s+inning\b/.test(
      m,
    )
  ) {
    return false;
  }
  if (
    /\b(?:1p|p1|2p|p2|3p|p3)\b|first period|1st period|second period|2nd period|third period|3rd period/.test(
      m,
    )
  ) {
    return false;
  }
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

/**
 * Classify NCAAF game-line family for per-market P0 gates.
 * Returns null when market is not a team game-line side/total/alt.
 */
export function classifyNcaafMarketFamily(
  market: string | null | undefined,
  opts?: { propMarketKey?: string | null },
): NcaafMarketFamily | null {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!m) return null;
  if (isPlayerPropMarketIdentity(m, opts)) return null;
  if (/alt\s*spread|alternate\s*spread|alt\s*total|alternate\s*total/.test(m)) {
    return "alts";
  }
  if (isTeamTotalMarket(m) || isGameTotalMarket(m)) return "totals";
  if (/moneyline|\bh2h\b|(?:^|[\s/])ml(?:$|[\s/])/.test(m)) return "moneyline";
  if (/spread|run line|puck line/.test(m)) return "spreads";
  return null;
}

function ncaafFamilyAllowedByResearch(family: NcaafMarketFamily): boolean {
  if (!ncaafIsolatedResearchUnlockActive()) return false;
  const allow = ncaafIsolatedResearchMarkets();
  if (!allow) return true;
  return allow.has(family);
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

  // NCAAF totals: per-market gate (independent of ML/spreads).
  if (
    sport === "ncaaf" &&
    (teamTotal || gameTotal)
  ) {
    const family = classifyNcaafMarketFamily(market, {
      propMarketKey: pick.propMarketKey,
    });
    if (family === "totals" || family === "alts") {
      if (isNcaafMarketProductValidated(family)) return false;
      if (ncaafFamilyAllowedByResearch(family)) return false;
      return true;
    }
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
 * True when NCAAF (incl. cfb alias) spread/ML/alt must not receive a sim-derived grade.
 * Per-market: moneyline unlock does not clear spreads/alts (P3).
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
  if (!P0_UNVALIDATED_NCAAF_GAME_LINE_SPORTS.has(sport)) return false;

  // Legacy master unlock (full restore) clears all side markets.
  if (NCAAF_GAME_LINE_SIM_VALIDATED) return false;

  const family = classifyNcaafMarketFamily(market, {
    propMarketKey: pick.propMarketKey,
  });
  if (family === "moneyline" || family === "spreads" || family === "alts") {
    if (isNcaafMarketProductValidated(family)) return false;
    if (ncaafFamilyAllowedByResearch(family)) return false;
    return true;
  }
  // Unclassified side → fail closed for NCAAF.
  return true;
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

/**
 * True for quarter / half / period / inning sides and totals.
 * Player props stay out. Full-game markets stay out.
 */
export function isUnvalidatedPeriodDecompositionMarket(pick: P0PickInput): boolean {
  const market = String(pick.market ?? "");
  if (!market) return false;
  if (isPlayerPropMarketIdentity(market, { propMarketKey: pick.propMarketKey })) {
    return false;
  }
  if (marketPeriodIsFullGame(market)) return false;
  // Odds API keys keep underscores (`totals_1st_1_innings`). Side detection
  // already normalizes those; total detection must see the same text.
  const normalized = market.toLowerCase().replace(/_/g, " ");
  return (
    isGameLineSideMarket(market) ||
    isTeamTotalMarket(market) ||
    isTeamTotalMarket(normalized) ||
    isGameTotalMarket(market) ||
    isGameTotalMarket(normalized)
  );
}

export function p0UnvalidatedPeriodDecompositionDecision(
  pick: P0PickInput,
): { accept: false; reason: string } | null {
  if (!isUnvalidatedPeriodDecompositionMarket(pick)) return null;
  return { accept: false, reason: P0_UNVALIDATED_PERIOD_DECOMPOSITION_REASON };
}

/**
 * Combined P0 reject for totals, unvalidated NCAAF/unknown-sport game lines,
 * and period markets graded from a full-game decomposition.
 */
export function p0UnvalidatedSimDecision(
  pick: P0PickInput,
): { accept: false; reason: string } | null {
  return (
    p0UnvalidatedSimTotalDecision(pick) ??
    p0UnvalidatedNcaafGameLineDecision(pick) ??
    p0UnvalidatedPeriodDecompositionDecision(pick)
  );
}

/**
 * True when a game-lines-only ask is locked exclusively to NCAAF (or aliases)
 * while NCAAF_GAME_LINE_SIM_VALIDATED is false — every FG side/total the scan
 * would seat is P0-blocked, so running slate sims only burns wall clock.
 *
 * Props-only / mixed-sport / unlocked boards return false so eligible sims still run.
 */
export function ncaafGameLineAskIsP0Blocked(opts: {
  gameLinesOnly: boolean;
  lockedSports: readonly string[] | null | undefined;
}): boolean {
  if (NCAAF_GAME_LINE_SIM_VALIDATED) return false;
  if (ncaafIsolatedResearchUnlockActive()) return false;
  if (!opts.gameLinesOnly) return false;
  const sports = (opts.lockedSports ?? [])
    .map((s) => String(s ?? "").toLowerCase().trim())
    .filter(Boolean)
    .map((s) => (NCAAF_SPORT_ALIASES.has(s) ? "ncaaf" : s));
  if (sports.length === 0) return false;
  return sports.every((s) => P0_UNVALIDATED_NCAAF_GAME_LINE_SPORTS.has(s));
}

/** User-facing note when a college game-line ask is P0-blocked before scan. */
export function p0BlockedNcaafGameLineAskNote(_requestedLegs: number): string {
  // Short fixed copy — digest-only policy block (no long quality-bar wording).
  return (
    "College football team picks are temporarily unavailable while validation is completed. No ticket was built."
  );
}

/**
 * True when every posted game-line candidate is P0-blocked (sides and/or totals).
 * Empty candidate lists return false — that is a thin board, not a P0 gate.
 * Used for gameLinesOnly scans so NFL/NHL (open sides) still sim, while a board
 * that only offers blocked markets exits without slate Monte Carlo.
 */
export function gameLineCandidatesFullyP0Blocked(
  candidates: readonly P0PickInput[],
): boolean {
  if (!candidates.length) return false;
  return candidates.every((c) => !!p0UnvalidatedSimDecision(c));
}

/** User note when the loaded game-line board is entirely P0-blocked. */
export function p0BlockedGameLineBoardNote(opts: {
  requestedLegs: number;
  candidateCount: number;
  sports?: readonly string[] | null;
}): string {
  const n = Math.max(0, Math.floor(opts.requestedLegs));
  const sports = [...new Set((opts.sports ?? []).map((s) => String(s).toLowerCase()).filter(Boolean))];
  const sportLabel =
    sports.length === 1
      ? sports[0]!.toUpperCase()
      : sports.length > 1
        ? sports.map((s) => s.toUpperCase()).join("/")
        : "this board";
  return (
    `${sportLabel} markets on the loaded board are temporarily blocked while their ` +
    `simulation grades stay unvalidated (${opts.candidateCount} posted line` +
    `${opts.candidateCount === 1 ? "" : "s"} checked). ` +
    `You asked for ${n} legs — no ticket was built, and no other sports were used to fill. ` +
    `Player props or validated game sides for other leagues remain eligible when you ask for them.`
  );
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

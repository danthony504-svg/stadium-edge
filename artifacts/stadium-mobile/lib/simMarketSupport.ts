// Which markets have a dedicated Monte Carlo model — only these get AI recommendations.

import { sportSimModelForSport, type SportSimModelId } from "./sportSimModels.ts";

export type { SportSimModelId };

export type SimModelKind =
  | "fullGame"
  | "period"
  | "teamTotal"
  | "raceTo"
  | "playerProp"
  | "unsupported";

export type SimPeriodScope =
  | "fg"
  | "h1"
  | "h2"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "f5"
  | "i1"
  | "p1"
  | "p2"
  | "p3";

const PERIOD_UNSUPPORTED_SPORTS = new Set(["tennis", "tabletennis", "cricket", "ufc", "mma", "soccer"]);

export function parseMarketPeriod(market: string): SimPeriodScope {
  const m = String(market ?? "").toLowerCase();
  if (/\bq1\b|first quarter|1st quarter/.test(m)) return "q1";
  if (/\bq2\b|second quarter|2nd quarter/.test(m)) return "q2";
  if (/\bq3\b|third quarter|3rd quarter/.test(m)) return "q3";
  if (/\bq4\b|fourth quarter|4th quarter/.test(m)) return "q4";
  if (/\b1h\b|first half|1st half/.test(m)) return "h1";
  if (/\b2h\b|second half|2nd half/.test(m)) return "h2";
  if (/\bf5\b|first 5|1st 5|five innings/.test(m)) return "f5";
  if (/\b1st inning\b|first inning/.test(m)) return "i1";
  if (/\b1p\b|first period|1st period/.test(m)) return "p1";
  if (/\b2p\b|second period|2nd period/.test(m)) return "p2";
  if (/\b3p\b|third period|3rd period/.test(m)) return "p3";
  return "fg";
}

export function simModelForMarket(
  market: string,
  opts: { isProp?: boolean; sport?: string },
): SimModelKind {
  if (opts.isProp) return "playerProp";
  const m = String(market ?? "").toLowerCase();
  if (/race to/.test(m)) return "raceTo";
  if (/team total/.test(m)) return "teamTotal";
  const period = parseMarketPeriod(market);
  if (period !== "fg") {
    const sport = (opts.sport ?? "").toLowerCase();
    if (PERIOD_UNSUPPORTED_SPORTS.has(sport)) return "unsupported";
    if (period === "p1" || period === "p2" || period === "p3") {
      return sport === "nhl" ? "period" : "unsupported";
    }
    if (period === "f5" || period === "i1") {
      return sport === "mlb" ? "period" : "unsupported";
    }
    return "period";
  }
  if (/moneyline|spread|run line|puck line|total|alt spread|alt total/.test(m)) return "fullGame";
  return "unsupported";
}

export function marketSupportsSimulation(
  market: string,
  opts: { isProp?: boolean; sport?: string },
): boolean {
  return simModelForMarket(market, opts) !== "unsupported";
}

/** Extreme hit rates that almost always indicate a market/period mapping bug. */
export const SIM_HIT_EXTREME_HIGH = 0.99;
export const SIM_HIT_EXTREME_LOW = 0.01;

export type SimHitSanityContext = {
  market?: string;
  sport?: string;
  period?: string;
  line?: number | null;
  odds?: number | null;
  simulatedStatistic?: string;
  hits?: number | null;
  losses?: number | null;
  impliedProb?: number | null;
  edge?: number | null;
  ev?: number | null;
  simHit: number;
  reason?: string;
};

export function isExtremeSimHit(simHit: number): boolean {
  return simHit >= SIM_HIT_EXTREME_HIGH || simHit <= SIM_HIT_EXTREME_LOW;
}

/** Log raw inputs when a sim hit collapses to ~0% or ~100% so mapping bugs can be audited. */
export function logExtremeSimHit(ctx: SimHitSanityContext): void {
  try {
    console.warn("[coach-sim-sanity]", JSON.stringify(ctx));
  } catch {
    console.warn("[coach-sim-sanity]", ctx.simHit, ctx.market, ctx.sport);
  }
}

/**
 * Reject non-finite, {0,1}, and extreme hits from grading.
 * Extreme hits are logged with market/period/line context for inspection.
 */
export function sanitizeSimHitForGrade(
  simHit: number | null | undefined,
  ctx?: Omit<SimHitSanityContext, "simHit">,
): number | null {
  if (simHit == null || !Number.isFinite(simHit)) return null;
  if (simHit <= 0 || simHit >= 1) return null;
  if (isExtremeSimHit(simHit)) {
    logExtremeSimHit({ ...ctx, simHit, reason: ctx?.reason ?? "extreme_sim_hit" });
    return null;
  }
  return simHit;
}

/**
 * True when the provider market + sport + period have a dedicated sim model.
 * Period markets must not fall through to full-game scores.
 */
export function simMarketMappingIsValid(pick: {
  market?: string;
  isProp?: boolean;
  sport?: string;
}): boolean {
  const market = pick.market ?? "";
  const kind = simModelForMarket(market, pick);
  if (kind === "unsupported") return false;
  if (pick.isProp || kind === "playerProp") return true;
  const period = parseMarketPeriod(market);
  if (period === "fg") return true;
  const sport = (pick.sport ?? "").toLowerCase();
  if (PERIOD_UNSUPPORTED_SPORTS.has(sport)) return false;
  if (period === "p1" || period === "p2" || period === "p3") return sport === "nhl";
  if (period === "f5" || period === "i1") return sport === "mlb";
  return true;
}

/** True when a pick has a real sim-backed grade (not rubric-only). */
export function pickHasSimGrade(
  pick: { market?: string; isProp?: boolean; sport?: string },
  simHit: number | null | undefined,
): boolean {
  if (!simMarketMappingIsValid(pick)) return false;
  const hit = sanitizeSimHitForGrade(simHit, {
    market: pick.market,
    sport: pick.sport,
    period: parseMarketPeriod(pick.market ?? ""),
  });
  return hit != null;
}

export const NOT_YET_AI_GRADED = "Not yet AI graded";

/** Sport-specific engine used for this pick's simulation. */
export function simEngineForPick(pick: { sport?: string; isProp?: boolean }): SportSimModelId | "player-prop" {
  if (pick.isProp) return "player-prop";
  return sportSimModelForSport(pick.sport ?? "");
}

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

/** Extreme hit rates — logged always; rejected only with mapping-mismatch evidence. */
export const SIM_HIT_EXTREME_HIGH = 0.99;
export const SIM_HIT_EXTREME_LOW = 0.01;

/** Plausible full-game total line bands by sport (rejects absurd FG totals like NFL 23.5). */
const GAME_TOTAL_LINE_RANGE: Record<string, { min: number; max: number }> = {
  nfl: { min: 32, max: 75 },
  ncaaf: { min: 35, max: 90 },
  nba: { min: 180, max: 280 },
  wnba: { min: 130, max: 200 },
  mlb: { min: 5, max: 14 },
  nhl: { min: 3.5, max: 9.5 },
  soccer: { min: 1.5, max: 5.5 },
  ncaab: { min: 110, max: 180 },
};

/** Plausible team-total line bands (not game totals). */
const TEAM_TOTAL_LINE_RANGE: Record<string, { min: number; max: number }> = {
  nfl: { min: 9, max: 42 },
  ncaaf: { min: 10, max: 55 },
  nba: { min: 85, max: 145 },
  wnba: { min: 60, max: 105 },
  mlb: { min: 2, max: 8 },
  nhl: { min: 1.5, max: 5.5 },
  ncaab: { min: 50, max: 100 },
};

export type SimHitSanityContext = {
  market?: string;
  sport?: string;
  period?: string;
  /** Period scope the cover query / engine actually used. */
  periodUsed?: string;
  line?: number | null;
  odds?: number | null;
  isProp?: boolean;
  normalizedMarketKey?: string;
  /** Stat key the market claims (expected). */
  expectedStatKey?: string;
  /** Stat key the simulator actually graded against. */
  simulationStatKey?: string;
  /** @deprecated prefer simulationStatKey */
  simulatedStatistic?: string;
  simulatedMean?: number | null;
  simulatedMedian?: number | null;
  simulatedStdev?: number | null;
  hits?: number | null;
  losses?: number | null;
  impliedProb?: number | null;
  edge?: number | null;
  ev?: number | null;
  /** True when a fallback path graded the pick (e.g. period→FG). */
  mappingFallbackUsed?: boolean;
  /** True when that fallback changes the wager's meaning. */
  mappingFallbackChangesMeaning?: boolean;
  simHit: number;
  reason?: string;
  decision?: "accept" | "reject";
};

export type SimIntegrityDecision = {
  accept: boolean;
  reason: string;
};

export function isExtremeSimHit(simHit: number): boolean {
  return simHit >= SIM_HIT_EXTREME_HIGH || simHit <= SIM_HIT_EXTREME_LOW;
}

export function normalizeMarketKey(
  market: string,
  opts: { isProp?: boolean; sport?: string } = {},
): string {
  const kind = simModelForMarket(market, opts);
  const period = parseMarketPeriod(market);
  return `${kind}|${period}|${String(market ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}`;
}

function sportKey(sport?: string | null): string {
  return String(sport ?? "")
    .toLowerCase()
    .trim();
}

function marketFamilyFromKey(statKey: string | undefined): "game_total" | "team_total" | "prop" | "other" {
  const k = String(statKey ?? "").toLowerCase();
  if (k.includes("team_total")) return "team_total";
  if (k.includes("game_total")) return "game_total";
  if (k.includes("player_prop") || k.startsWith("prop:")) return "prop";
  return "other";
}

/**
 * Evidence-based integrity check. Extreme hits alone never reject —
 * only mapping / period / family / line-range / fallback mismatches do.
 */
export function assessSimMarketIntegrity(
  simHit: number,
  ctx: Omit<SimHitSanityContext, "simHit" | "reason" | "decision">,
): SimIntegrityDecision {
  const market = ctx.market ?? "";
  const sport = sportKey(ctx.sport);
  const pick = { market, sport: ctx.sport, isProp: ctx.isProp };
  const periodClaimed = (ctx.period ?? parseMarketPeriod(market)) as SimPeriodScope;
  const periodUsed = (ctx.periodUsed ?? periodClaimed) as SimPeriodScope;
  const expectedKind = simModelForMarket(market, pick);
  const simStat = ctx.simulationStatKey ?? ctx.simulatedStatistic ?? ctx.expectedStatKey ?? "";
  const expectedStat =
    ctx.expectedStatKey ??
    (ctx.isProp || expectedKind === "playerProp"
      ? "player_prop"
      : expectedKind === "teamTotal"
        ? `${periodClaimed}:team_total`
        : expectedKind === "fullGame" || expectedKind === "period"
          ? /total/i.test(market) && !/team total/i.test(market)
            ? `${periodClaimed}:game_total`
            : `${periodClaimed}:${expectedKind}`
          : `${periodClaimed}:${expectedKind}`);

  if (!simMarketMappingIsValid(pick)) {
    return { accept: false, reason: "unsupported_market_or_period_mapping" };
  }
  if (periodClaimed !== "fg" && periodUsed === "fg") {
    return { accept: false, reason: "period_mapped_to_full_game_simulation" };
  }
  if (periodClaimed !== periodUsed && periodClaimed !== "fg") {
    return { accept: false, reason: `period_mismatch_claimed_${periodClaimed}_used_${periodUsed}` };
  }
  if (ctx.mappingFallbackUsed && ctx.mappingFallbackChangesMeaning) {
    return { accept: false, reason: "mapping_fallback_changed_wager_meaning" };
  }

  const claimedFamily =
    expectedKind === "teamTotal"
      ? "team_total"
      : expectedKind === "playerProp" || ctx.isProp
        ? "prop"
        : /total/i.test(market) && !/team total/i.test(market)
          ? "game_total"
          : "other";
  const usedFamily = marketFamilyFromKey(simStat || expectedStat);
  if (
    claimedFamily !== "other" &&
    usedFamily !== "other" &&
    claimedFamily !== usedFamily
  ) {
    return {
      accept: false,
      reason: `market_family_mismatch_claimed_${claimedFamily}_used_${usedFamily}`,
    };
  }
  if (
    /team total/i.test(market) &&
    usedFamily === "game_total"
  ) {
    return { accept: false, reason: "team_total_evaluated_as_game_total" };
  }
  if (
    !/team total/i.test(market) &&
    /\btotal\b/i.test(market) &&
    !ctx.isProp &&
    usedFamily === "team_total"
  ) {
    return { accept: false, reason: "game_total_evaluated_as_team_total" };
  }
  if (
    (ctx.isProp || expectedKind === "playerProp") &&
    simStat &&
    !/player_prop|prop:/i.test(simStat) &&
    /game_total|team_total|winner|margin/i.test(simStat)
  ) {
    return { accept: false, reason: "player_prop_mapped_to_wrong_simulation_stat" };
  }

  const line = ctx.line;
  if (line != null && Number.isFinite(line)) {
    if (claimedFamily === "game_total") {
      const band = GAME_TOTAL_LINE_RANGE[sport];
      if (band && (line < band.min || line > band.max)) {
        return {
          accept: false,
          reason: `line_outside_reasonable_range_for_game_total_${sport}_${band.min}_${band.max}`,
        };
      }
    }
    if (claimedFamily === "team_total") {
      const band = TEAM_TOTAL_LINE_RANGE[sport];
      if (band && (line < band.min || line > band.max)) {
        return {
          accept: false,
          reason: `line_outside_reasonable_range_for_team_total_${sport}_${band.min}_${band.max}`,
        };
      }
    }
    // Distribution check only for game/team totals — extreme prop hits with a soft
    // or tough line are often legitimate when the prop mapping itself is valid.
    const mean = ctx.simulatedMean;
    const stdev = ctx.simulatedStdev;
    if (
      (claimedFamily === "game_total" || claimedFamily === "team_total") &&
      mean != null &&
      Number.isFinite(mean) &&
      isExtremeSimHit(simHit)
    ) {
      const sigma =
        stdev != null && Number.isFinite(stdev) && stdev > 0
          ? stdev
          : Math.max(Math.abs(mean) * 0.12, claimedFamily === "game_total" ? 3 : 1);
      const z = Math.abs(line - mean) / sigma;
      if (z >= 4.5) {
        return {
          accept: false,
          reason: `line_outside_simulated_distribution_z_${z.toFixed(1)}`,
        };
      }
    }
  }

  if (isExtremeSimHit(simHit)) {
    return { accept: true, reason: "extreme_sim_hit_mapping_valid" };
  }
  return { accept: true, reason: "mapping_valid" };
}

/** Log every extreme sim hit with accept/reject decision and audit fields. */
export function logExtremeSimHit(ctx: SimHitSanityContext): void {
  const payload = {
    sport: ctx.sport ?? null,
    market: ctx.market ?? null,
    normalizedMarketKey:
      ctx.normalizedMarketKey ??
      normalizeMarketKey(ctx.market ?? "", { isProp: ctx.isProp, sport: ctx.sport }),
    period: ctx.period ?? parseMarketPeriod(ctx.market ?? ""),
    periodUsed: ctx.periodUsed ?? null,
    line: ctx.line ?? null,
    odds: ctx.odds ?? null,
    simulationStatKey: ctx.simulationStatKey ?? ctx.simulatedStatistic ?? null,
    expectedStatKey: ctx.expectedStatKey ?? null,
    simulatedMean: ctx.simulatedMean ?? null,
    simulatedMedian: ctx.simulatedMedian ?? null,
    simulatedStdev: ctx.simulatedStdev ?? null,
    simHit: ctx.simHit,
    impliedProb: ctx.impliedProb ?? null,
    edge: ctx.edge ?? null,
    ev: ctx.ev ?? null,
    hits: ctx.hits ?? null,
    losses: ctx.losses ?? null,
    decision: ctx.decision ?? null,
    reason: ctx.reason ?? null,
  };
  try {
    console.warn("[coach-sim-integrity]", JSON.stringify(payload));
  } catch {
    console.warn("[coach-sim-integrity]", ctx.simHit, ctx.market, ctx.sport, ctx.reason);
  }
}

/**
 * Sanitize a sim hit for grading.
 * Exact 0/1 and non-finite values are unusable.
 * Extreme hits are logged always and rejected only when integrity evidence shows a mismatch.
 */
export function sanitizeSimHitForGrade(
  simHit: number | null | undefined,
  ctx?: Omit<SimHitSanityContext, "simHit" | "decision">,
): number | null {
  if (simHit == null || !Number.isFinite(simHit)) return null;
  if (simHit <= 0 || simHit >= 1) return null;

  const baseCtx = ctx ?? {};
  const decision = assessSimMarketIntegrity(simHit, baseCtx);
  if (isExtremeSimHit(simHit) || !decision.accept) {
    logExtremeSimHit({
      ...baseCtx,
      simHit,
      decision: decision.accept ? "accept" : "reject",
      reason: decision.reason,
    });
  }
  return decision.accept ? simHit : null;
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
    isProp: pick.isProp,
    period: parseMarketPeriod(pick.market ?? ""),
    simulationStatKey: pick.isProp ? "player_prop" : undefined,
    expectedStatKey: pick.isProp ? "player_prop" : undefined,
  });
  return hit != null;
}

export const NOT_YET_AI_GRADED = "Not yet AI graded";

/** Sport-specific engine used for this pick's simulation. */
export function simEngineForPick(pick: { sport?: string; isProp?: boolean }): SportSimModelId | "player-prop" {
  if (pick.isProp) return "player-prop";
  return sportSimModelForSport(pick.sport ?? "");
}

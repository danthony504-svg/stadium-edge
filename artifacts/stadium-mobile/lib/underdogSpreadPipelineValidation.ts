/**
 * Selection-time validation for opposing-side game lines through the final
 * selection belt. Uses 10,000 simulations and only inputs available at
 * selection time.
 *
 * Ranking mirrors Coach Final AI / gameLineOptimizer.rankEvaluated:
 * composite → simAligned → edge/EV — never raw cover across differently
 * priced spreads, ML, or alt lines.
 *
 * Reports Coach delivered metrics separately from baselines (blanket-home,
 * win-prob favorite, raw higher-cover).
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import {
  compareLegMetrics,
  enforceConsistentGameSides,
  gameSideLegMetrics,
  type GameSideConsistencyResult,
} from "./gameSideConsistency.ts";
import { optimizeGameLinePicksToBestFinalAi } from "./gameLineOptimizer.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";
import { p0UnvalidatedSimDecision } from "./coachP0UnvalidatedTotals.ts";

export const HISTORICAL_SIM_DRAWS = 10_000;

export type SelectionTimeGame = {
  sport: "nfl" | "ncaaf";
  game: string;
  homeProjected: number;
  awayProjected: number;
  homeSpread: number;
  awaySpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  /** Optional moneyline prices for cross-market conflict cases. */
  homeMlOdds?: number;
  awayMlOdds?: number;
  closingHomeSpread: number | null;
  homeFinal: number | null;
  awayFinal: number | null;
};

export type PipelineTraceStep = {
  stage: string;
  picks: string[];
  rejected?: Array<{ pick: string; reason: string }>;
  note?: string;
};

export type DeliveredPickMetrics = {
  games: number;
  covers: number;
  coverRate: number;
  meanClvPts: number | null;
  clvGames: number;
};

export type BaselineKind = "coach" | "blanket_home" | "winprob_favorite" | "raw_higher_cover";

export type HistoricalValidationReport = {
  simulations: number;
  label: "regression_sample" | "broader_eval";
  sports: Array<"nfl" | "ncaaf">;
  traces: Array<{
    game: string;
    sport: string;
    favoriteWinProb: number;
    underdogWinProb: number;
    steps: PipelineTraceStep[];
    delivered: string | null;
    /** True when delivered side is the underdog (lower outright win-prob). */
    underdogDelivered: boolean;
    /** True when delivered pick matches Final AI/value best of the two sides. */
    bestCandidateSurvived: boolean;
    p0Blocked: boolean;
  }>;
  baselines: Record<BaselineKind, DeliveredPickMetrics>;
  summary: string;
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Selection-time 10k score draws — no final/closing leakage into the sim. */
export function simulateCoverRatesAtSelection(
  game: SelectionTimeGame,
  draws = HISTORICAL_SIM_DRAWS,
  seed = 42,
): {
  sim: CoachGameSimEntry;
  homeCover: number;
  awayCover: number;
  homeWinProb: number;
  awayWinProb: number;
  homeMlHit: number;
  awayMlHit: number;
} {
  const rnd = mulberry32(seed);
  const sigma = game.sport === "ncaaf" ? 12 : 10;
  let homeWins = 0;
  let homeCovers = 0;
  let awayCovers = 0;
  let homeSum = 0;
  let awaySum = 0;
  for (let i = 0; i < draws; i++) {
    const u1 = Math.max(1e-9, rnd());
    const u2 = Math.max(1e-9, rnd());
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    const hs = Math.max(0, game.homeProjected + z0 * sigma);
    const as = Math.max(0, game.awayProjected + z1 * sigma);
    homeSum += hs;
    awaySum += as;
    const margin = hs - as;
    if (margin > 0) homeWins += 1;
    if (margin + game.homeSpread > 0) homeCovers += 1;
    if (-margin + game.awaySpread > 0) awayCovers += 1;
  }
  const homeWinProb = homeWins / draws;
  const awayWinProb = 1 - homeWinProb;
  const homeCover = homeCovers / draws;
  const awayCover = awayCovers / draws;
  const { away, home } = split(game.game);
  const coverHitRates: Record<string, number> = {
    [`${game.game}|spread|${home} ${fmtSpread(game.homeSpread)}`.toLowerCase()]: homeCover,
    [`${game.game}|spread|${away} ${fmtSpread(game.awaySpread)}`.toLowerCase()]: awayCover,
    [`${game.game}|moneyline|${home} ml`.toLowerCase()]: homeWinProb,
    [`${game.game}|moneyline|${away} ml`.toLowerCase()]: awayWinProb,
  };
  const sim: CoachGameSimEntry = {
    sport: game.sport,
    simulations: draws,
    homeWinProbability: homeWinProb,
    awayWinProbability: awayWinProb,
    tieProbability: 0,
    homeProjectedScore: homeSum / draws,
    awayProjectedScore: awaySum / draws,
    mostLikelyWinner: homeWinProb >= awayWinProb ? "home" : "away",
    mostLikelyWinnerPct: Math.max(homeWinProb, awayWinProb),
    confidenceScore: Math.round(Math.max(homeWinProb, awayWinProb) * 100),
    coverHitRates,
  };
  return {
    sim,
    homeCover,
    awayCover,
    homeWinProb,
    awayWinProb,
    homeMlHit: homeWinProb,
    awayMlHit: awayWinProb,
  };
}

function split(game: string): { away: string; home: string } {
  const parts = game.split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

function fmtSpread(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

function americanImplied(odds: number): number {
  if (odds < 0) return -odds / (-odds + 100);
  return 100 / (odds + 100);
}

/**
 * Approximate Final AI composite from selection-time edge + alignment.
 * Edge/value dominates; raw cover only enters via simAligned boolean — never
 * as a large additive (cover−0.5) term that would outrank priced value.
 */
export function finalAiStyleComposite(edgePct: number, cover: number): number {
  const simAligned = cover >= 0.52;
  // Mirror rankEvaluated spirit: value first, alignment bonus second.
  return Math.max(1, Math.min(9.9, 5.5 + edgePct * 0.45 + (simAligned ? 0.7 : 0)));
}

function scoredLine(
  game: SelectionTimeGame,
  opts: {
    market: "Spread" | "Moneyline";
    side: "home" | "away";
    hit: number;
    odds: number;
    line?: number;
  },
): ParsedPick {
  const { away, home } = split(game.game);
  const team = opts.side === "home" ? home : away;
  const implied = americanImplied(opts.odds);
  const edgePct = (opts.hit - implied) * 100;
  const composite = finalAiStyleComposite(edgePct, opts.hit);
  const pick =
    opts.market === "Moneyline"
      ? `${team} ML`
      : `${team} ${fmtSpread(opts.line ?? 0)}`;
  return {
    game: game.game,
    market: opts.market,
    pick,
    odds: opts.odds,
    isProp: false,
    sport: game.sport,
    finalAiScore: {
      composite: Math.round(composite * 10) / 10,
      grade: composite >= 7.5 ? "A-" : composite >= 6.5 ? "B+" : composite >= 5.5 ? "B" : "C+",
      confidencePct: Math.round(opts.hit * 100),
      edgePct: Math.round(edgePct * 10) / 10,
      simHit: opts.hit,
      simAligned: opts.hit >= 0.52,
      highRiskValuePlay: false,
      recommends: opts.hit >= 0.52 && edgePct > 0,
      factors: [],
      rubric: {
        scores: {},
        composite: Math.round(composite * 10) / 10,
        grade: "B+",
        confidencePct: Math.round(opts.hit * 100),
        edgePct: Math.round(edgePct * 10) / 10,
      },
    },
  };
}

function scoredSpread(
  game: SelectionTimeGame,
  side: "home" | "away",
  cover: number,
): ParsedPick {
  return scoredLine(game, {
    market: "Spread",
    side,
    hit: cover,
    odds: side === "home" ? game.homeSpreadOdds : game.awaySpreadOdds,
    line: side === "home" ? game.homeSpread : game.awaySpread,
  });
}

function coversFinal(game: SelectionTimeGame, pick: ParsedPick): boolean | null {
  if (game.homeFinal == null || game.awayFinal == null) return null;
  const margin = game.homeFinal - game.awayFinal;
  const { away, home } = split(game.game);
  const homeNick = home.split(" ").pop()!.toLowerCase();
  const awayNick = away.split(" ").pop()!.toLowerCase();
  const isHome = pick.pick.toLowerCase().includes(homeNick);
  const isAway = pick.pick.toLowerCase().includes(awayNick);
  if (/ml|moneyline/i.test(pick.market) || /\bml\b/i.test(pick.pick)) {
    if (isHome && !isAway) return margin > 0;
    if (isAway && !isHome) return margin < 0;
    return null;
  }
  const m = pick.pick.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const line = Number(m[1]);
  if (isHome && !isAway) return margin + line > 0;
  if (isAway && !isHome) return -margin + line > 0;
  return null;
}

function clvPts(game: SelectionTimeGame, pick: ParsedPick): number | null {
  if (game.closingHomeSpread == null) return null;
  if (/ml|moneyline/i.test(pick.market)) return null;
  const m = pick.pick.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const line = Number(m[1]);
  const { home } = split(game.game);
  const isHome = pick.pick.toLowerCase().includes(home.split(" ").pop()!.toLowerCase());
  const deliveredHomeLine = isHome ? line : -line;
  return game.closingHomeSpread - deliveredHomeLine;
}

function pickIsUnderdog(pick: ParsedPick, homeWinProb: number): boolean {
  const { away, home } = split(pick.game);
  const homeNick = home.split(" ").pop()!.toLowerCase();
  const awayNick = away.split(" ").pop()!.toLowerCase();
  const isHome = pick.pick.toLowerCase().includes(homeNick);
  const isAway = pick.pick.toLowerCase().includes(awayNick);
  if (homeWinProb >= 0.5) return isAway && !isHome;
  return isHome && !isAway;
}

/** Trace one game through scoring → consistency → optimizer → delivery. */
export function traceUnderdogSpreadPipeline(game: SelectionTimeGame): {
  steps: PipelineTraceStep[];
  delivered: ParsedPick | null;
  /** @deprecated use underdogDelivered — kept for existing tests */
  underdogSurvived: boolean;
  underdogDelivered: boolean;
  bestCandidateSurvived: boolean;
  bestCandidate: ParsedPick;
  p0Blocked: boolean;
  favoriteWinProb: number;
  underdogWinProb: number;
  sideResult: GameSideConsistencyResult;
} {
  const { sim, homeCover, awayCover, homeWinProb, awayWinProb } =
    simulateCoverRatesAtSelection(game);
  const homeLeg = scoredSpread(game, "home", homeCover);
  const awayLeg = scoredSpread(game, "away", awayCover);

  const p0Blocked =
    p0UnvalidatedSimDecision(homeLeg) != null || p0UnvalidatedSimDecision(awayLeg) != null;

  const homeM = gameSideLegMetrics(homeLeg, sim);
  const awayM = gameSideLegMetrics(awayLeg, sim);
  const bestCandidate =
    compareLegMetrics(homeM, awayM) >= 0 ? homeLeg : awayLeg;

  const steps: PipelineTraceStep[] = [
    {
      stage: "board-scoring",
      picks: [
        `${homeLeg.pick} (comp ${homeLeg.finalAiScore!.composite}, edge ${homeLeg.finalAiScore!.edgePct}, cover ${(homeCover * 100).toFixed(1)}%)`,
        `${awayLeg.pick} (comp ${awayLeg.finalAiScore!.composite}, edge ${awayLeg.finalAiScore!.edgePct}, cover ${(awayCover * 100).toFixed(1)}%)`,
      ],
      note: `selection-time 10k sim; homeWin=${(homeWinProb * 100).toFixed(1)}% awayWin=${(awayWinProb * 100).toFixed(1)}%; best=${bestCandidate.pick}`,
    },
  ];

  const sideResult = enforceConsistentGameSides([homeLeg, awayLeg], {
    simByGame: new Map([[game.game, sim]]),
  });
  steps.push({
    stage: "side-consistency",
    picks: sideResult.picks.map((p) => p.pick),
    rejected: (sideResult.resolutions ?? []).flatMap((r) =>
      r.rejections.map((x) => ({ pick: x.pick, reason: x.reason })),
    ),
    note: sideResult.resolutions?.[0]?.reason ?? sideResult.note,
  });

  const opt = optimizeGameLinePicksToBestFinalAi(sideResult.picks, new Map([[game.game, sim]]), {
    evalLinesByGame: new Map([
      [
        game.game,
        [
          {
            sport: game.sport,
            game: game.game,
            market: "Spread",
            pick: homeLeg.pick,
            odds: homeLeg.odds,
            edge: homeLeg.finalAiScore!.edgePct,
            noVigFair: homeCover,
          } satisfies RealOddsEntry,
          {
            sport: game.sport,
            game: game.game,
            market: "Spread",
            pick: awayLeg.pick,
            odds: awayLeg.odds,
            edge: awayLeg.finalAiScore!.edgePct,
            noVigFair: awayCover,
          } satisfies RealOddsEntry,
        ],
      ],
    ]),
    realOdds: [],
  });
  const afterOpt = opt.picks.length > 0 ? opt.picks : sideResult.picks;
  steps.push({
    stage: "optimizer",
    picks: afterOpt.map((p) => p.pick),
    note: opt.picks.length
      ? opt.swapped
        ? `swapped ${opt.swapped} rung(s) within side`
        : "no swap"
      : "optimizer empty — retained side-consistency pick",
  });

  const deliveredList = finalizeCoachDeliveryPicks(afterOpt, {
    simByGame: new Map([[game.game, sim]]),
  });
  steps.push({
    stage: "delivery",
    picks: deliveredList.map((p) => p.pick),
  });

  const delivered = deliveredList[0] ?? null;
  const underdogDelivered =
    delivered != null && pickIsUnderdog(delivered, homeWinProb);
  const bestCandidateSurvived =
    delivered != null &&
    delivered.pick === bestCandidate.pick &&
    delivered.market === bestCandidate.market;

  return {
    steps,
    delivered,
    underdogSurvived: underdogDelivered,
    underdogDelivered,
    bestCandidateSurvived,
    bestCandidate,
    p0Blocked,
    favoriteWinProb: Math.max(homeWinProb, awayWinProb),
    underdogWinProb: Math.min(homeWinProb, awayWinProb),
    sideResult,
  };
}

function emptyMetrics(): DeliveredPickMetrics {
  return { games: 0, covers: 0, coverRate: 0, meanClvPts: null, clvGames: 0 };
}

function finalizeMetrics(m: DeliveredPickMetrics): DeliveredPickMetrics {
  return {
    ...m,
    coverRate: m.games > 0 ? m.covers / m.games : 0,
    meanClvPts: m.clvGames > 0 ? m.meanClvPts : null,
  };
}

function accumulate(
  m: DeliveredPickMetrics,
  game: SelectionTimeGame,
  pick: ParsedPick | null,
  clvSum: { v: number },
): void {
  if (!pick) return;
  const cov = coversFinal(game, pick);
  if (cov != null) {
    m.games += 1;
    if (cov) m.covers += 1;
  }
  const c = clvPts(game, pick);
  if (c != null) {
    m.clvGames += 1;
    clvSum.v += c;
  }
}

function baselinePick(
  kind: Exclude<BaselineKind, "coach">,
  game: SelectionTimeGame,
): ParsedPick {
  const { sim, homeCover, awayCover, homeWinProb } = simulateCoverRatesAtSelection(game);
  const homeLeg = scoredSpread(game, "home", homeCover);
  const awayLeg = scoredSpread(game, "away", awayCover);
  if (kind === "blanket_home") return homeLeg;
  if (kind === "winprob_favorite") {
    return homeWinProb >= 0.5 ? homeLeg : awayLeg;
  }
  // raw_higher_cover — intentionally naive (what we must NOT prefer over value)
  void sim;
  return homeCover >= awayCover ? homeLeg : awayLeg;
}

export function runHistoricalUnderdogSpreadValidation(
  games: SelectionTimeGame[],
  label: "regression_sample" | "broader_eval" = "broader_eval",
): HistoricalValidationReport {
  const traces: HistoricalValidationReport["traces"] = [];
  const baselines: Record<BaselineKind, DeliveredPickMetrics> = {
    coach: emptyMetrics(),
    blanket_home: emptyMetrics(),
    winprob_favorite: emptyMetrics(),
    raw_higher_cover: emptyMetrics(),
  };
  const clvSums: Record<BaselineKind, { v: number }> = {
    coach: { v: 0 },
    blanket_home: { v: 0 },
    winprob_favorite: { v: 0 },
    raw_higher_cover: { v: 0 },
  };

  for (const game of games) {
    const trace = traceUnderdogSpreadPipeline(game);
    traces.push({
      game: game.game,
      sport: game.sport,
      favoriteWinProb: trace.favoriteWinProb,
      underdogWinProb: trace.underdogWinProb,
      steps: trace.steps,
      delivered: trace.delivered?.pick ?? null,
      underdogDelivered: trace.underdogDelivered,
      bestCandidateSurvived: trace.bestCandidateSurvived,
      p0Blocked: trace.p0Blocked,
    });

    for (const kind of ["blanket_home", "winprob_favorite", "raw_higher_cover"] as const) {
      accumulate(baselines[kind], game, baselinePick(kind, game), clvSums[kind]);
    }

    if (trace.p0Blocked) continue;
    accumulate(baselines.coach, game, trace.delivered, clvSums.coach);
  }

  for (const kind of Object.keys(baselines) as BaselineKind[]) {
    if (baselines[kind].clvGames > 0) {
      baselines[kind].meanClvPts = clvSums[kind].v / baselines[kind].clvGames;
    }
    baselines[kind] = finalizeMetrics(baselines[kind]);
  }

  const eligible = traces.filter((t) => !t.p0Blocked);
  const bestOk = eligible.filter((t) => t.bestCandidateSurvived).length;
  const dogOk = eligible.filter((t) => t.underdogDelivered).length;
  const summary =
    `[${label}] Best Final AI/value candidate survived ${bestOk}/${eligible.length} non-P0; ` +
    `underdog delivered ${dogOk}/${eligible.length}. ` +
    `Coach cover ${(baselines.coach.coverRate * 100).toFixed(1)}% (n=${baselines.coach.games}) | ` +
    `blanket-home ${(baselines.blanket_home.coverRate * 100).toFixed(1)}% | ` +
    `winprob-fav ${(baselines.winprob_favorite.coverRate * 100).toFixed(1)}% | ` +
    `raw-cover ${(baselines.raw_higher_cover.coverRate * 100).toFixed(1)}%. ` +
    `Coach CLV ${baselines.coach.meanClvPts == null ? "n/a" : baselines.coach.meanClvPts.toFixed(2) + " pts"} ` +
    `vs blanket-home ${baselines.blanket_home.meanClvPts == null ? "n/a" : baselines.blanket_home.meanClvPts.toFixed(2) + " pts"}.`;

  return {
    simulations: HISTORICAL_SIM_DRAWS,
    label,
    sports: [...new Set(games.map((g) => g.sport))],
    traces,
    baselines,
    summary,
  };
}

/**
 * Original four NFL games — labeled regression sample only.
 * Not a production performance claim; use BROADER_EVAL_FIXTURES for comparison.
 */
export const REGRESSION_SAMPLE_FIXTURES: SelectionTimeGame[] = [
  {
    sport: "nfl",
    game: "Detroit Lions @ Kansas City Chiefs",
    homeProjected: 27,
    awayProjected: 24,
    homeSpread: -6.5,
    awaySpread: 6.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -7,
    homeFinal: 27,
    awayFinal: 24,
  },
  {
    sport: "nfl",
    game: "New York Jets @ Buffalo Bills",
    homeProjected: 26,
    awayProjected: 17,
    homeSpread: -9.5,
    awaySpread: 9.5,
    homeSpreadOdds: -115,
    awaySpreadOdds: -105,
    closingHomeSpread: -10,
    homeFinal: 30,
    awayFinal: 14,
  },
  {
    sport: "nfl",
    game: "Atlanta Falcons @ Seattle Seahawks",
    homeProjected: 23,
    awayProjected: 22,
    homeSpread: -2.5,
    awaySpread: 2.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -3,
    homeFinal: 20,
    awayFinal: 27,
  },
  {
    sport: "nfl",
    game: "Carolina Panthers @ Tampa Bay Buccaneers",
    homeProjected: 24,
    awayProjected: 18,
    homeSpread: -6,
    awaySpread: 6,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -5.5,
    homeFinal: 21,
    awayFinal: 24,
  },
];

/** @deprecated use REGRESSION_SAMPLE_FIXTURES */
export const UNDERDOG_SPREAD_HISTORICAL_FIXTURES = REGRESSION_SAMPLE_FIXTURES;

/** Broader selection-time slate for Coach vs baseline comparison (NFL + NCAAF). */
export const BROADER_EVAL_FIXTURES: SelectionTimeGame[] = [
  ...REGRESSION_SAMPLE_FIXTURES,
  {
    sport: "nfl",
    game: "Green Bay Packers @ Chicago Bears",
    homeProjected: 21,
    awayProjected: 24,
    homeSpread: 3,
    awaySpread: -3,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: 2.5,
    homeFinal: 17,
    awayFinal: 27,
  },
  {
    sport: "nfl",
    game: "Miami Dolphins @ New England Patriots",
    homeProjected: 20,
    awayProjected: 22,
    homeSpread: 1.5,
    awaySpread: -1.5,
    homeSpreadOdds: -105,
    awaySpreadOdds: -115,
    closingHomeSpread: 1,
    homeFinal: 24,
    awayFinal: 20,
  },
  {
    sport: "nfl",
    game: "Dallas Cowboys @ Philadelphia Eagles",
    homeProjected: 28,
    awayProjected: 21,
    homeSpread: -7,
    awaySpread: 7,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -6.5,
    homeFinal: 31,
    awayFinal: 17,
  },
  {
    sport: "nfl",
    game: "Las Vegas Raiders @ Denver Broncos",
    homeProjected: 23,
    awayProjected: 19,
    homeSpread: -3.5,
    awaySpread: 3.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -4,
    homeFinal: 20,
    awayFinal: 23,
  },
  {
    sport: "nfl",
    game: "Arizona Cardinals @ Los Angeles Rams",
    homeProjected: 25,
    awayProjected: 22,
    homeSpread: -4,
    awaySpread: 4,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -3.5,
    homeFinal: 27,
    awayFinal: 24,
  },
  {
    sport: "nfl",
    game: "Houston Texans @ Indianapolis Colts",
    homeProjected: 22,
    awayProjected: 23,
    homeSpread: 1,
    awaySpread: -1,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: 1.5,
    homeFinal: 20,
    awayFinal: 27,
  },
  {
    sport: "ncaaf",
    game: "Michigan Wolverines @ Ohio State Buckeyes",
    homeProjected: 28,
    awayProjected: 24,
    homeSpread: -3.5,
    awaySpread: 3.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -4,
    homeFinal: 30,
    awayFinal: 24,
  },
  {
    sport: "ncaaf",
    game: "Iowa Hawkeyes @ Minnesota Golden Gophers",
    homeProjected: 20,
    awayProjected: 19,
    homeSpread: -1.5,
    awaySpread: 1.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -2.5,
    homeFinal: 17,
    awayFinal: 20,
  },
  {
    sport: "ncaaf",
    game: "Alabama Crimson Tide @ LSU Tigers",
    homeProjected: 27,
    awayProjected: 26,
    homeSpread: -1.5,
    awaySpread: 1.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: -2,
    homeFinal: 24,
    awayFinal: 28,
  },
  {
    sport: "ncaaf",
    game: "Oregon Ducks @ Washington Huskies",
    homeProjected: 24,
    awayProjected: 29,
    homeSpread: 4.5,
    awaySpread: -4.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    closingHomeSpread: 3.5,
    homeFinal: 21,
    awayFinal: 31,
  },
];

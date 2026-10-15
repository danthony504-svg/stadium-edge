/**
 * Historical / selection-time validation for underdog spreads through the
 * actual final selection belt: board scores → side consistency → optimizer →
 * delivery. Uses 10,000 simulations and only inputs available at selection time.
 *
 * Reports delivered-pick CLV + outcome metrics separately from a blanket-home
 * (always take home spread) benchmark. Does not flip NCAAF P0.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import {
  enforceConsistentGameSides,
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
  /** Projected home/away means known at selection (form / slate inputs). */
  homeProjected: number;
  awayProjected: number;
  /** Posted main spreads at selection (home negative when favored). */
  homeSpread: number;
  awaySpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  /** Closing home spread (for CLV). Null → CLV insufficient. */
  closingHomeSpread: number | null;
  /** Final score (for outcome). Null → outcome skipped. */
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
  /** Mean (close − selection) in points for delivered home-relative line; + = beat close. */
  meanClvPts: number | null;
  clvGames: number;
};

export type HistoricalValidationReport = {
  simulations: number;
  sports: Array<"nfl" | "ncaaf">;
  traces: Array<{
    game: string;
    sport: string;
    favoriteWinProb: number;
    underdogWinProb: number;
    steps: PipelineTraceStep[];
    delivered: string | null;
    underdogSurvived: boolean;
    p0Blocked: boolean;
  }>;
  delivered: DeliveredPickMetrics;
  blanketHome: DeliveredPickMetrics;
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
} {
  const rnd = mulberry32(seed);
  // Football scoring noise ~ N(0, 10) around projected means.
  const sigma = game.sport === "ncaaf" ? 12 : 10;
  let homeWins = 0;
  let homeCovers = 0;
  let awayCovers = 0;
  let homeSum = 0;
  let awaySum = 0;
  for (let i = 0; i < draws; i++) {
    // Box-Muller
    const u1 = Math.max(1e-9, rnd());
    const u2 = Math.max(1e-9, rnd());
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    const hs = Math.max(0, game.homeProjected + z0 * sigma);
    const as = Math.max(0, game.awayProjected + z1 * sigma);
    homeSum += hs;
    awaySum += as;
    const margin = hs - as; // home − away
    if (margin > 0) homeWins += 1;
    // Home spread e.g. -6.5: home covers if margin > 6.5
    if (margin + game.homeSpread > 0) homeCovers += 1;
    // Away spread e.g. +6.5: away covers if -margin + awaySpread > 0
    if (-margin + game.awaySpread > 0) awayCovers += 1;
  }
  const homeWinProb = homeWins / draws;
  const awayWinProb = 1 - homeWinProb;
  const homeCover = homeCovers / draws;
  const awayCover = awayCovers / draws;
  const { away, home } = split(game.game);
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
    coverHitRates: {
      [`${game.game}|spread|${home} ${fmtSpread(game.homeSpread)}`.toLowerCase()]: homeCover,
      [`${game.game}|spread|${away} ${fmtSpread(game.awaySpread)}`.toLowerCase()]: awayCover,
    },
  };
  return { sim, homeCover, awayCover, homeWinProb, awayWinProb };
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

function scoredSpread(
  game: SelectionTimeGame,
  side: "home" | "away",
  cover: number,
): ParsedPick {
  const { away, home } = split(game.game);
  const team = side === "home" ? home : away;
  const line = side === "home" ? game.homeSpread : game.awaySpread;
  const odds = side === "home" ? game.homeSpreadOdds : game.awaySpreadOdds;
  const implied = americanImplied(odds);
  const edgePct = (cover - implied) * 100;
  // Composite tilted by edge + cover — mirrors Final AI ranking spirit.
  const composite = Math.max(1, Math.min(9.9, 5.5 + edgePct * 0.35 + (cover - 0.5) * 4));
  return {
    game: game.game,
    market: "Spread",
    pick: `${team} ${fmtSpread(line)}`,
    odds,
    isProp: false,
    sport: game.sport,
    finalAiScore: {
      composite: Math.round(composite * 10) / 10,
      grade: composite >= 7.5 ? "A-" : composite >= 6.5 ? "B+" : "B",
      confidencePct: Math.round(cover * 100),
      edgePct: Math.round(edgePct * 10) / 10,
      simHit: cover,
      simAligned: cover >= 0.52,
      highRiskValuePlay: false,
      recommends: cover >= 0.52 && edgePct > 0,
      factors: [],
      rubric: {
        scores: {},
        composite: Math.round(composite * 10) / 10,
        grade: "B+",
        confidencePct: Math.round(cover * 100),
        edgePct: Math.round(edgePct * 10) / 10,
      },
    },
  };
}

function coversFinal(game: SelectionTimeGame, pick: ParsedPick): boolean | null {
  if (game.homeFinal == null || game.awayFinal == null) return null;
  const margin = game.homeFinal - game.awayFinal;
  const { away, home } = split(game.game);
  const m = pick.pick.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const line = Number(m[1]);
  const isHome = pick.pick.toLowerCase().includes(home.toLowerCase().split(" ").pop()!);
  const isAway = pick.pick.toLowerCase().includes(away.toLowerCase().split(" ").pop()!);
  if (isHome && !isAway) return margin + line > 0;
  if (isAway && !isHome) return -margin + line > 0;
  return null;
}

function clvPts(game: SelectionTimeGame, pick: ParsedPick): number | null {
  if (game.closingHomeSpread == null) return null;
  const m = pick.pick.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const line = Number(m[1]);
  const { home } = split(game.game);
  const isHome = pick.pick.toLowerCase().includes(home.toLowerCase().split(" ").pop()!);
  // Home-relative: delivered home -6.5 vs close -7 → +0.5 CLV; away +6.5 ≡ home -6.5.
  const deliveredHomeLine = isHome ? line : -line;
  return game.closingHomeSpread - deliveredHomeLine;
}

/** Trace one game through scoring → consistency → optimizer → delivery. */
export function traceUnderdogSpreadPipeline(game: SelectionTimeGame): {
  steps: PipelineTraceStep[];
  delivered: ParsedPick | null;
  underdogSurvived: boolean;
  p0Blocked: boolean;
  favoriteWinProb: number;
  underdogWinProb: number;
  sideResult: GameSideConsistencyResult;
} {
  const { sim, homeCover, awayCover, homeWinProb, awayWinProb } =
    simulateCoverRatesAtSelection(game);
  const homeLeg = scoredSpread(game, "home", homeCover);
  const awayLeg = scoredSpread(game, "away", awayCover);

  // P0: NCAAF game lines remain blocked for live Coach; validation still traces
  // the shared resolver but marks p0Blocked so restore stays armed.
  const p0Blocked =
    p0UnvalidatedSimDecision(homeLeg) != null || p0UnvalidatedSimDecision(awayLeg) != null;

  const steps: PipelineTraceStep[] = [
    {
      stage: "board-scoring",
      picks: [
        `${homeLeg.pick} (comp ${homeLeg.finalAiScore!.composite}, edge ${homeLeg.finalAiScore!.edgePct}, cover ${(homeCover * 100).toFixed(1)}%)`,
        `${awayLeg.pick} (comp ${awayLeg.finalAiScore!.composite}, edge ${awayLeg.finalAiScore!.edgePct}, cover ${(awayCover * 100).toFixed(1)}%)`,
      ],
      note: `selection-time 10k sim; homeWin=${(homeWinProb * 100).toFixed(1)}% awayWin=${(awayWinProb * 100).toFixed(1)}%`,
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
  // Optimizer may no-op / empty when full rubrics are unavailable — keep the
  // side-consistency winner so delivery still reflects the selection belt.
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
  const { away } = split(game.game);
  const awayNick = away.split(" ").pop()!.toLowerCase();
  const underdogIsAway = homeWinProb > awayWinProb;
  const underdogSurvived =
    delivered != null &&
    (underdogIsAway
      ? delivered.pick.toLowerCase().includes(awayNick)
      : !delivered.pick.toLowerCase().includes(awayNick));

  return {
    steps,
    delivered,
    underdogSurvived,
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

/** Shared NFL/NCAAF historical validation through the final selection pipeline. */
export function runHistoricalUnderdogSpreadValidation(
  games: SelectionTimeGame[],
): HistoricalValidationReport {
  const traces: HistoricalValidationReport["traces"] = [];
  let delivered = emptyMetrics();
  let blanket = emptyMetrics();
  let clvSum = 0;
  let blanketClvSum = 0;

  for (const game of games) {
    const trace = traceUnderdogSpreadPipeline(game);
    traces.push({
      game: game.game,
      sport: game.sport,
      favoriteWinProb: trace.favoriteWinProb,
      underdogWinProb: trace.underdogWinProb,
      steps: trace.steps,
      delivered: trace.delivered?.pick ?? null,
      underdogSurvived: trace.underdogSurvived,
      p0Blocked: trace.p0Blocked,
    });

    // Blanket-home benchmark: always take the home posted spread.
    const homePick = scoredSpread(
      game,
      "home",
      simulateCoverRatesAtSelection(game).homeCover,
    );
    const homeCovered = coversFinal(game, homePick);
    if (homeCovered != null) {
      blanket.games += 1;
      if (homeCovered) blanket.covers += 1;
    }
    const homeClv = clvPts(game, homePick);
    if (homeClv != null) {
      blanket.clvGames += 1;
      blanketClvSum += homeClv;
    }

    if (trace.p0Blocked) continue; // NCAAF game-line P0 — do not count as live delivery

    if (trace.delivered) {
      const cov = coversFinal(game, trace.delivered);
      if (cov != null) {
        delivered.games += 1;
        if (cov) delivered.covers += 1;
      }
      const c = clvPts(game, trace.delivered);
      if (c != null) {
        delivered.clvGames += 1;
        clvSum += c;
      }
    }
  }

  if (delivered.clvGames > 0) delivered.meanClvPts = clvSum / delivered.clvGames;
  if (blanket.clvGames > 0) blanket.meanClvPts = blanketClvSum / blanket.clvGames;

  delivered = finalizeMetrics(delivered);
  blanket = finalizeMetrics(blanket);

  const survived = traces.filter((t) => t.underdogSurvived && !t.p0Blocked).length;
  const contested = traces.filter((t) => !t.p0Blocked).length;
  const summary =
    `Delivered underdog-or-best survived ${survived}/${contested} non-P0 games; ` +
    `delivered cover ${(delivered.coverRate * 100).toFixed(1)}% (n=${delivered.games}) ` +
    `vs blanket-home ${(blanket.coverRate * 100).toFixed(1)}% (n=${blanket.games}); ` +
    `delivered mean CLV ${delivered.meanClvPts == null ? "INSUFFICIENT_DATA" : delivered.meanClvPts.toFixed(2) + " pts"} ` +
    `vs blanket-home ${blanket.meanClvPts == null ? "INSUFFICIENT_DATA" : blanket.meanClvPts.toFixed(2) + " pts"}.`;

  return {
    simulations: HISTORICAL_SIM_DRAWS,
    sports: [...new Set(games.map((g) => g.sport))],
    traces,
    delivered,
    blanketHome: blanket,
    summary,
  };
}

/** Built-in selection-time fixture slate (NFL + NCAAF). Closing/finals for CLV/outcome. */
export const UNDERDOG_SPREAD_HISTORICAL_FIXTURES: SelectionTimeGame[] = [
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
];

/**
 * Proof tests for the Coach-only AI fix:
 * 1) Partial tickets stay temporary until scanComplete
 * 2) NFL/NCAAF survive every generic sport-selection path
 * 3) Extreme / mismatched market sims are rejected (100% / +64.9% case)
 *
 * Reports the requested test matrix with synthetic board-scan staging.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import { coachBuildSports } from "./chatContextPriority.ts";
import {
  boardScanIsComplete,
  coachTicketShowsScanInProgress,
  preferFinalBoardScanForDelivery,
} from "./coachScanPolicy.ts";
import { coachLiveScanSports } from "./coachSlateFreshness.ts";
import {
  buildGameCoverQuery,
  deriveCoverHitRatesFromOutcomes,
  gameSimHitForPick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { simEdgeFromHit } from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import {
  isExtremeSimHit,
  parseMarketPeriod,
  pickHasSimGrade,
  sanitizeSimHitForGrade,
  simMarketMappingIsValid,
  simModelForMarket,
} from "./simMarketSupport.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";

const ALL_SPORTS = ["mlb", "wnba", "nba", "nhl", "soccer", "ufc", "tennis", "nfl", "ncaaf", "ncaab"];

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 70,
  edgePct: 5,
  simHit: 0.58,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 70, edgePct: 5, scores: {} as never },
};

function report(label: string, row: Record<string, unknown>) {
  console.log(`[coach-fix-matrix] ${label}`, JSON.stringify(row));
}

function leg(
  overrides: Partial<BoardScoredLeg> & { pick: ParsedPick },
): BoardScoredLeg {
  const pick = {
    ...overrides.pick,
    finalAiScore: overrides.pick.finalAiScore ?? mainScore,
  };
  return {
    evPct: 4,
    edgePct: 5,
    confidencePct: 70,
    impliedProbPct: 52,
    lineShoppingScore: 6,
    grade: "B+",
    simHit: 0.58,
    composite: 7.2,
    rankScore: 7.2,
    ...overrides,
    pick,
  } as BoardScoredLeg;
}

function sportMix(picks: ParsedPick[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const p of picks) {
    const s = (p.sport ?? "unknown").toLowerCase();
    mix[s] = (mix[s] ?? 0) + 1;
  }
  return mix;
}

function counts(picks: ParsedPick[]) {
  return {
    finalCount: picks.length,
    playerPropCount: picks.filter((p) => p.isProp).length,
    gameLineCount: picks.filter((p) => !p.isProp).length,
    sportMix: sportMix(picks),
  };
}

function stageScenario(opts: {
  label: string;
  requested: number;
  scored: BoardScoredLeg[];
  scanComplete: boolean;
}) {
  const staged = buildStagedTicketFromScan(opts.scored, opts.requested, "proof-seed");
  const picks = staged.picks;
  const partialCount = Math.min(picks.length, opts.requested);
  const scanInProgress = coachTicketShowsScanInProgress({
    picksShortOfTarget: partialCount < opts.requested,
    buildIdle: true,
    boardScanComplete: opts.scanComplete ? true : false,
  });

  const shortfallReasons: string[] = [];
  if (opts.scanComplete && picks.length < opts.requested) {
    shortfallReasons.push(
      `delivered=${picks.length}<requested=${opts.requested}`,
      `qualifiedCandidates=${opts.scored.length}`,
      `mainQualified=${staged.breakdown.mainQualified}`,
      `altQualified=${staged.breakdown.altQualified}`,
    );
  }

  const row = {
    requestedCount: opts.requested,
    partialCounts: opts.scanComplete ? 0 : partialCount,
    ...counts(picks),
    scanComplete: opts.scanComplete,
    scanInProgressWhileIdlePartial: scanInProgress,
    rejectionReasons: shortfallReasons,
  };
  report(opts.label, row);
  return { staged, row, scanInProgress, picks };
}

test("sport-selection paths keep NFL and NCAAF for generic parlays", () => {
  for (const n of [3, 6, 10]) {
    const build = coachBuildSports(`Build me a ${n}-leg parlay`, n, ALL_SPORTS);
    assert.ok(build.includes("nfl"), `coachBuildSports(${n}) missing nfl`);
    assert.ok(build.includes("ncaaf"), `coachBuildSports(${n}) missing ncaaf`);
  }
  const live = coachLiveScanSports();
  assert.ok(live.includes("nfl"));
  assert.ok(live.includes("ncaaf"));
  assert.ok(live.includes("mlb"));
  assert.ok(live.includes("nba"));
  assert.ok(live.indexOf("nfl") < live.indexOf("soccer"));
  assert.ok(live.indexOf("ncaaf") < live.indexOf("wnba"));

  const nflOnly = coachBuildSports("NFL only 6 leg parlay", 6, ALL_SPORTS);
  assert.deepEqual(nflOnly, ["nfl"]);
  const cfbOnly = coachBuildSports("CFB 6 leg parlay", 6, ALL_SPORTS);
  assert.ok(cfbOnly.includes("ncaaf"));
  const mixed = coachBuildSports("mixed NFL CFB NBA parlay", 6, ALL_SPORTS);
  assert.ok(mixed.includes("nfl") && mixed.includes("ncaaf") && mixed.includes("nba"));
});

test("matrix: 6-leg generic — partial temporary, final uses all qualified up to request", () => {
  const scored = [
    leg({
      pick: { game: "A @ B", market: "Spread", pick: "A -3.5", odds: -110, isProp: false, sport: "mlb" },
    }),
    leg({
      pick: { game: "C @ D", market: "Total", pick: "Over 8.5", odds: -105, isProp: false, sport: "nba" },
    }),
    leg({
      pick: {
        game: "E @ F",
        market: "Moneyline",
        pick: "E ML",
        odds: 140,
        isProp: false,
        sport: "nhl",
      },
    }),
    leg({
      pick: {
        game: "SF @ LAR",
        market: "Spread",
        pick: "49ers -2.5",
        odds: -110,
        isProp: false,
        sport: "nfl",
      },
      simHit: 0.57,
    }),
    leg({
      pick: {
        game: "OSU @ Michigan",
        market: "Total",
        pick: "Under 48.5",
        odds: -108,
        isProp: false,
        sport: "ncaaf",
      },
      simHit: 0.56,
    }),
    leg({
      pick: {
        game: "SF @ LAR",
        market: "Passing Yards",
        pick: "Over 265.5",
        odds: -115,
        isProp: true,
        sport: "nfl",
        propLine: 265.5,
        propSide: "Over",
      },
      simHit: 0.55,
    }),
  ];
  const partial = stageScenario({
    label: "6-leg-generic-partial",
    requested: 6,
    scored: scored.slice(0, 3),
    scanComplete: false,
  });
  assert.equal(partial.scanInProgress, true);

  const complete = stageScenario({
    label: "6-leg-generic-final",
    requested: 6,
    scored,
    scanComplete: true,
  });
  assert.equal(complete.row.scanComplete, true);
  assert.ok((complete.row.finalCount as number) <= 6);
  assert.ok((complete.row.sportMix as Record<string, number>).nfl >= 1);
  assert.ok((complete.row.sportMix as Record<string, number>).ncaaf >= 1);
});

test("matrix: 10-leg generic shortfall — fixture intentionally supplies only 4 qualified candidates", () => {
  const scored = Array.from({ length: 4 }, (_, i) =>
    leg({
      pick: {
        game: `G${i} @ H${i}`,
        market: "Spread",
        pick: `G${i} -1.5`,
        odds: -110,
        isProp: false,
        sport: i % 2 === 0 ? "nfl" : "nba",
      },
    }),
  );
  assert.equal(scored.length, 4, "fixture supplies exactly 4 pre-qualified legs");
  const result = stageScenario({
    label: "10-leg-generic-shortfall-intentional-4-qualified",
    requested: 10,
    scored,
    scanComplete: true,
  });
  assert.equal(result.row.scanComplete, true);
  assert.equal(result.row.finalCount, 4, "final equals qualified pool size, not a hard 4-cap");
  assert.ok((result.row.rejectionReasons as string[]).length > 0);
  assert.equal(
    coachTicketShowsScanInProgress({
      picksShortOfTarget: true,
      buildIdle: true,
      boardScanComplete: true,
    }),
    false,
  );
});

test("matrix: NFL-only / CFB-only / mixed sport paths", () => {
  const nfl = Array.from({ length: 6 }, (_, i) =>
    leg({
      pick: {
        game: `NFL${i}a @ NFL${i}b`,
        market: i % 2 ? "Passing Yards" : "Spread",
        pick: i % 2 ? "Over 250.5" : "Home -3",
        odds: -110,
        isProp: i % 2 === 1,
        sport: "nfl",
        ...(i % 2 ? { propLine: 250.5, propSide: "Over" as const } : {}),
      },
    }),
  );
  const cfb = Array.from({ length: 6 }, (_, i) =>
    leg({
      pick: {
        game: `CFB${i}a @ CFB${i}b`,
        market: "Total",
        pick: "Over 52.5",
        odds: -110,
        isProp: false,
        sport: "ncaaf",
      },
    }),
  );
  const mixed = [
    ...nfl.slice(0, 2),
    ...cfb.slice(0, 2),
    leg({
      pick: {
        game: "A @ B",
        market: "Moneyline",
        pick: "A ML",
        odds: 130,
        isProp: false,
        sport: "mlb",
      },
    }),
    leg({
      pick: {
        game: "C @ D",
        market: "Points",
        pick: "Over 24.5",
        odds: -115,
        isProp: true,
        sport: "nba",
        propLine: 24.5,
        propSide: "Over",
      },
    }),
  ];
  stageScenario({ label: "nfl-only-6", requested: 6, scored: nfl, scanComplete: true });
  stageScenario({ label: "cfb-only-6", requested: 6, scored: cfb, scanComplete: true });
  const mix = stageScenario({
    label: "mixed-nfl-cfb-other",
    requested: 6,
    scored: mixed,
    scanComplete: true,
  });
  const sports = mix.row.sportMix as Record<string, number>;
  assert.ok(sports.nfl >= 1 && sports.ncaaf >= 1);
  assert.ok((sports.mlb ?? 0) + (sports.nba ?? 0) >= 1);
});

test("preferFinalBoardScanForDelivery never promotes incomplete partials", () => {
  const partial = { picks: [{}, {}, {}], scanComplete: false, requestedLegs: 6 };
  const final = { picks: [{}, {}, {}, {}, {}, {}], scanComplete: true, requestedLegs: 6 };
  assert.equal(preferFinalBoardScanForDelivery(6, partial, null), null);
  assert.equal(preferFinalBoardScanForDelivery(6, partial, final), final);
  assert.equal(boardScanIsComplete(partial), false);
  assert.equal(boardScanIsComplete(final), true);
});

test("sim integrity: mismatched period×sport cannot grade", () => {
  assert.equal(simModelForMarket("Q1 Total", { sport: "soccer" }), "unsupported");
  assert.equal(simMarketMappingIsValid({ market: "Q1 Total", sport: "soccer" }), false);
  assert.equal(pickHasSimGrade({ market: "Q1 Total", sport: "soccer" }, 0.6), false);

  const pick: ParsedPick = {
    game: "A @ B",
    market: "Q1 Total",
    pick: "Over 45.5",
    odds: -110,
    isProp: false,
    sport: "soccer",
  };
  const sim: CoachGameSimEntry = {
    sport: "soccer",
    simulations: 10_000,
    homeWinProbability: 0.5,
    awayWinProbability: 0.5,
    tieProbability: 0,
    homeProjectedScore: 1.4,
    awayProjectedScore: 1.2,
    mostLikelyWinner: "home",
    mostLikelyWinnerPct: 0.5,
    confidenceScore: 50,
    coverHitRates: {},
    outcomes: {
      homeScores: Array(100).fill(2),
      awayScores: Array(100).fill(1),
    },
  };
  assert.equal(gameSimHitForPick(pick, sim), null);
});

test("NFL Over 23.5 full-game mismatch is rejected by market integrity — not extremity alone", () => {
  // Reproduces the suspicious 49ers/Rams Over 23.5 display: NFL full-game total
  // line ~23.5 vs typical ~45–52 projected totals → near-certain overs.
  const pick: ParsedPick = {
    game: "San Francisco 49ers @ Los Angeles Rams",
    market: "Total",
    pick: "Over 23.5",
    odds: -110,
    isProp: false,
    sport: "nfl",
  };
  const query = buildGameCoverQuery(pick);
  assert.ok(query);
  assert.equal(query!.kind, "total");
  assert.equal(query!.line, 23.5);
  assert.equal(parseMarketPeriod(pick.market), "fg");

  const homeScores = Array.from({ length: 1000 }, () => 24 + Math.random() * 8);
  const awayScores = Array.from({ length: 1000 }, () => 22 + Math.random() * 8);
  const rates = deriveCoverHitRatesFromOutcomes(
    { homeScores, awayScores },
    [query!],
    "nfl",
  );
  const rawHit = rates[query!.id]!;
  assert.ok(rawHit >= 0.99, `expected near-certain over, got ${rawHit}`);
  assert.equal(isExtremeSimHit(rawHit), true);

  const edge = simEdgeFromHit(rawHit, pick.odds)!;
  assert.ok(edge > 40, `edge ${edge}`);

  const sim: CoachGameSimEntry = {
    sport: "nfl",
    simulations: 1000,
    homeWinProbability: 0.52,
    awayWinProbability: 0.48,
    tieProbability: 0,
    homeProjectedScore: 27,
    awayProjectedScore: 25,
    mostLikelyWinner: "home",
    mostLikelyWinnerPct: 0.52,
    confidenceScore: 60,
    coverHitRates: { [query!.id]: rawHit },
    outcomes: { homeScores, awayScores },
  };
  const graded = gameSimHitForPick(pick, sim);
  assert.equal(graded, null, "mismatched NFL FG total line must be rejected");
  assert.equal(
    sanitizeSimHitForGrade(rawHit, {
      market: pick.market,
      sport: "nfl",
      period: "fg",
      periodUsed: "fg",
      line: 23.5,
      simulationStatKey: "fg:game_total:over",
      expectedStatKey: "fg:game_total:over",
      simulatedMean: 52,
      simulatedStdev: 6,
    }),
    null,
  );

  report("100pct-over-23.5-case", {
    rawHit,
    displayPct: Math.round(rawHit * 100),
    impliedProb: impliedProb(pick.odds),
    edge,
    gradedHit: graded,
    rejected: true,
    rejectBasis: "market_integrity_not_extremity_alone",
  });
});

test("legitimate prop simHit >= 0.99 is allowed when mapping is valid", () => {
  const hit = sanitizeSimHitForGrade(0.993, {
    market: "Passing Yards",
    sport: "nfl",
    isProp: true,
    line: 149.5,
    odds: -200,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
    simulatedMean: 278,
    simulatedMedian: 276,
    simulatedStdev: 40,
  });
  assert.equal(hit, 0.993);
  assert.equal(
    pickHasSimGrade({ market: "Passing Yards", sport: "nfl", isProp: true }, 0.993),
    true,
  );
});

test("legitimate Under simHit <= 0.01 is allowed when mapping is valid", () => {
  const hit = sanitizeSimHitForGrade(0.007, {
    market: "Rushing Yards",
    sport: "ncaaf",
    isProp: true,
    line: 140.5,
    odds: 450,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
    simulatedMean: 42,
    simulatedMedian: 40,
    simulatedStdev: 16,
  });
  assert.equal(hit, 0.007);
});

test("normal 50–90% simulations are unchanged", () => {
  for (const h of [0.5, 0.55, 0.72, 0.89]) {
    assert.equal(
      sanitizeSimHitForGrade(h, {
        market: "Spread",
        sport: "nfl",
        line: -3.5,
        simulationStatKey: "fg:margin:home",
      }),
      h,
    );
    assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, h), true);
  }
});

test("NFL/CFB props, game lines, team totals, and alt lines still flow when graded normally", () => {
  const samples: Array<{ market: string; sport: string; isProp?: boolean; hit: number }> = [
    { market: "Passing Yards", sport: "nfl", isProp: true, hit: 0.58 },
    { market: "Spread", sport: "nfl", hit: 0.56 },
    { market: "Team Total", sport: "nfl", hit: 0.54 },
    { market: "Alt Spread", sport: "nfl", hit: 0.53 },
    { market: "Receiving Yards", sport: "ncaaf", isProp: true, hit: 0.57 },
    { market: "Total", sport: "ncaaf", hit: 0.55 },
    { market: "Team Total", sport: "ncaaf", hit: 0.52 },
    { market: "Alt Total", sport: "ncaaf", hit: 0.51 },
  ];
  for (const s of samples) {
    assert.equal(
      sanitizeSimHitForGrade(s.hit, {
        market: s.market,
        sport: s.sport,
        isProp: s.isProp,
        simulationStatKey: s.isProp
          ? "player_prop"
          : /team total/i.test(s.market)
            ? "fg:team_total:home:over"
            : /total/i.test(s.market)
              ? "fg:game_total:over"
              : "fg:margin:home",
        expectedStatKey: s.isProp ? "player_prop" : undefined,
        line: s.isProp ? 65.5 : /total/i.test(s.market) ? (/team/i.test(s.market) ? 22.5 : 48.5) : -3.5,
      }),
      s.hit,
      `${s.sport} ${s.market}`,
    );
  }
});

test("correctly mapped near-even total remains gradable", () => {
  const pick: ParsedPick = {
    game: "San Francisco 49ers @ Los Angeles Rams",
    market: "Total",
    pick: "Over 47.5",
    odds: -110,
    isProp: false,
    sport: "nfl",
  };
  const query = buildGameCoverQuery(pick)!;
  const sim: CoachGameSimEntry = {
    sport: "nfl",
    simulations: 10_000,
    homeWinProbability: 0.52,
    awayWinProbability: 0.48,
    tieProbability: 0,
    homeProjectedScore: 24,
    awayProjectedScore: 23,
    mostLikelyWinner: "home",
    mostLikelyWinnerPct: 0.52,
    confidenceScore: 60,
    coverHitRates: { [query.id]: 0.55 },
  };
  assert.equal(gameSimHitForPick(pick, sim), 0.55);
  assert.equal(pickHasSimGrade(pick, 0.55), true);
});

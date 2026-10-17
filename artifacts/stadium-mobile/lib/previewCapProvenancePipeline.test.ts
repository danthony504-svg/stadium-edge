/**
 * Isolated preview-candidate pipeline proof on the c5246bc baseline shape:
 * default same-game cap, GT/TT block, provenance-matched grades, honest shortfall,
 * unchanged qualification floors, integer-line push EV.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";

import type { ParsedPick } from "../components/PickCard.tsx";
import { applyDeliveryGroundingGate } from "./coachDeliveryGrounding.ts";
import { wouldStackCorrelatedGameAndTeamTotals } from "./coachP0UnvalidatedTotals.ts";
import {
  attachSeatedSimProvenance,
  formatSimEdgePp,
  formatSimEvPctLabel,
  recomputeDerivedEdgeEv,
  simProvenanceIsVerifiable,
  withholdUnverifiableSeatedGrades,
} from "./coachSimProvenance.ts";
import { buildCoachReliabilityBody } from "./coachReliabilityReporter.ts";
import {
  buildGameCoverQuery,
  coverPushRateForQuery,
  deriveCoverHitRatesFromOutcomes,
  deriveCoverPushRatesFromOutcomes,
  gameSimHitForPick,
} from "./gameSimScoring.ts";
import { simEdgeFromHit, simEvPct } from "./gameSimQualityGates.ts";
import {
  maxLegsPerGame,
  progressiveLegsPerGameRelaxation,
} from "./parlayCorrelationScore.ts";
import { boardLegPoolRole, topUpTicketFromQualifiedScored, type BoardScoredLeg } from "./ticketStaging.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";

const GAME = "Tampa Bay Rays @ Cleveland Guardians";
const ASK = "5 leg mlb";
const REQUEST_ID = `mlb-preview-cap-${Date.now()}`;

const score = (simHit: number, edgePct: number, grade = "B+") => ({
  composite: 8,
  grade,
  confidencePct: 68,
  edgePct,
  simHit,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: {
    scores: {
      matchup: null,
      trend: null,
      lineValue: null,
      injury: null,
      lineShopping: null,
      simulation: null,
    },
    composite: 8,
    grade,
    confidencePct: 68,
    edgePct,
  },
});

function scored(
  overrides: Partial<ParsedPick> & Pick<ParsedPick, "market" | "pick" | "odds">,
  rank: number,
  simHit: number,
): BoardScoredLeg {
  const edge = simEdgeFromHit(simHit, overrides.odds)!;
  const pick: ParsedPick = {
    game: GAME,
    isProp: false,
    sport: "mlb",
    finalAiScore: score(simHit, edge),
    ...overrides,
  };
  return {
    pick,
    evPct: simEvPct(simHit, overrides.odds),
    edgePct: edge,
    confidencePct: 68,
    impliedProbPct: null,
    lineShoppingScore: null,
    grade: "B+",
    simHit,
    composite: 8,
    rankScore: rank,
  };
}

test("preview pipeline: default cap + GT/TT block + provenance ticket + reliability identity", () => {
  assert.equal(maxLegsPerGame(5), 2);
  assert.deepEqual(progressiveLegsPerGameRelaxation(5), []);

  // Sim draws: mean ~low totals; exact cover rates per query id.
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  for (let i = 0; i < 6000; i++) {
    homeScores.push(2);
    awayScores.push(1); // 3
  }
  for (let i = 0; i < 2000; i++) {
    homeScores.push(3);
    awayScores.push(3); // 6
  }
  for (let i = 0; i < 1000; i++) {
    homeScores.push(4);
    awayScores.push(3); // 7 — integer-line push for Under/Over 7
  }
  for (let i = 0; i < 1000; i++) {
    homeScores.push(4);
    awayScores.push(4); // 8
  }

  const u65 = buildGameCoverQuery({
    game: GAME,
    market: "Total",
    pick: "Under 6.5",
    odds: -105,
    isProp: false,
    sport: "mlb",
  })!;
  const u7 = buildGameCoverQuery({
    game: GAME,
    market: "Total",
    pick: "Under 7",
    odds: -110,
    isProp: false,
    sport: "mlb",
  })!;
  const tt = buildGameCoverQuery({
    game: GAME,
    market: "Team Total",
    pick: "Guardians Under 4.5",
    odds: -315,
    isProp: false,
    sport: "mlb",
  })!;
  const spread = buildGameCoverQuery({
    game: GAME,
    market: "Alt Spread",
    pick: "Guardians +1.5",
    odds: -186,
    isProp: false,
    sport: "mlb",
  })!;

  const queries = [u65, u7, tt, spread];
  const hitRates = deriveCoverHitRatesFromOutcomes(
    { homeScores, awayScores },
    queries,
    "mlb",
  );
  const pushRates = deriveCoverPushRatesFromOutcomes(
    { homeScores, awayScores },
    queries,
    "mlb",
  );
  const sim = {
    sport: "mlb",
    simulations: 10_000,
    homeWinProbability: 0.55,
    awayWinProbability: 0.45,
    tieProbability: 0,
    homeProjectedScore: 2.5,
    awayProjectedScore: 2.0,
    mostLikelyWinner: "home" as const,
    mostLikelyWinnerPct: 0.55,
    confidenceScore: 55,
    engineVersion: "sport-sim-v1",
    outcomes: { homeScores, awayScores },
    coverHitRates: hitRates,
    coverPushRates: pushRates,
  };

  // Exact sample hit for Under 6.5 — not mean/stdev.
  const u65Hit = gameSimHitForPick(
    { game: GAME, market: "Total", pick: "Under 6.5", odds: -105, isProp: false, sport: "mlb" },
    sim,
  );
  assert.ok(u65Hit != null && u65Hit >= 0.8, `U6.5 hit=${u65Hit}`);
  assert.equal(u65Hit, hitRates[u65.id]);
  assert.equal(coverPushRateForQuery(u65, sim), 0); // half-point
  assert.ok((pushRates[u7.id] ?? 0) > 0, "integer Under 7 must have push mass");

  const pushEv = simEvPct(hitRates[u7.id]!, -110, pushRates[u7.id]!);
  const noPushEv = simEvPct(hitRates[u7.id]!, -110, 0);
  assert.ok(pushEv != null && noPushEv != null && pushEv > noPushEv);

  const pool: BoardScoredLeg[] = [
    scored({ market: "Alt Spread", pick: "Guardians +1.5", odds: -186 }, 100, 0.72),
    scored({ market: "Total", pick: "Under 6.5", odds: -105 }, 95, u65Hit!),
    // Qualifying TT (positive edge) that must still be blocked by same-side GT stack.
    scored({ market: "Team Total", pick: "Guardians Under 4.5", odds: -120 }, 94, 0.72),
    scored(
      {
        market: "Hits",
        pick: "Jose Ramirez Over 0.5 Hits",
        odds: -180,
        isProp: true,
        player: "Jose Ramirez",
        teamAbbr: "CLE",
      },
      93,
      0.66,
    ),
    scored(
      {
        market: "Hits+Runs+RBIs",
        pick: "Chase DeLauter Over 1.5 Hits+Runs+RBIs",
        odds: 106,
        isProp: true,
        player: "Chase DeLauter",
        teamAbbr: "CLE",
      },
      92,
      0.58,
    ),
    scored(
      {
        market: "Hits",
        pick: "Junior Caminero Over 0.5 Hits",
        odds: -140,
        isProp: true,
        player: "Junior Caminero",
        teamAbbr: "TB",
      },
      91,
      0.61,
    ),
  ];

  // Qualification unchanged — each pool leg clears board role.
  for (const leg of pool) {
    assert.ok(boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null, leg.pick.pick);
    assert.ok(pickHasSimGrade(leg.pick, leg.simHit));
  }

  const short = [pool[0]!.pick, pool[1]!.pick];
  const topped = topUpTicketFromQualifiedScored(short, pool, 5);
  const gameLines = topped.filter((p) => !p.isProp);
  assert.ok(gameLines.length <= 2, `cap breach: ${gameLines.length} game-lines`);
  assert.equal(
    wouldStackCorrelatedGameAndTeamTotals(
      { game: GAME, market: "Team Total", pick: "Guardians Under 4.5" },
      [{ game: GAME, market: "Total", pick: "Under 6.5" }],
    ),
    true,
  );
  assert.ok(
    !topped.some((p) => /team total/i.test(p.market) && /under/i.test(p.pick)),
    "prohibited TT same-side stack must stay blocked",
  );
  // Honest shortfall under default max-2 game-lines (props may fill remaining).
  const toppedGameLines = topped.filter((p) => !p.isProp);
  assert.ok(toppedGameLines.length <= 2, `top-up GL cap, got ${toppedGameLines.length}`);

  // Provenance: each delivered grade matches game/market/line/side/simHit/edge.
  const grounded = applyDeliveryGroundingGate({
    picks: topped,
    qualifiedCandidates: pool.map((l) => l.pick),
    target: 5,
  });
  const delivered = withholdUnverifiableSeatedGrades(grounded.picks);
  const deliveredGameLines = delivered.filter((p) => !p.isProp);
  assert.ok(
    deliveredGameLines.length <= 2,
    `delivery must keep default GL cap, got ${deliveredGameLines.length}`,
  );
  assert.ok(
    !delivered.some((p) => /team total/i.test(p.market ?? "") && /under/i.test(p.pick)),
    "delivery refill must not seat prohibited TT same-side stack",
  );
  for (const p of delivered) {
    const seated = attachSeatedSimProvenance(p, p.finalAiScore?.simHit ?? null);
    assert.equal(seated.game, GAME);
    assert.ok(seated.market && seated.pick);
    assert.ok(simProvenanceIsVerifiable(seated), `${seated.market} ${seated.pick}`);
    const coverQ = seated.isProp ? null : buildGameCoverQuery(seated);
    if (!seated.isProp) {
      assert.ok(coverQ, `cover query for ${seated.market} ${seated.pick}`);
    }
    const push = coverQ ? coverPushRateForQuery(coverQ, sim) : 0;
    const { edgePct, evPct } = recomputeDerivedEdgeEv(
      seated.finalAiScore!.simHit,
      seated.odds,
      push,
    );
    assert.equal(seated.finalAiScore!.edgePct, edgePct);
    assert.ok(edgePct != null);
    assert.match(formatSimEdgePp(edgePct!), /pp$/);
    if (evPct != null) assert.match(formatSimEvPctLabel(evPct), /% EV$/);
  }

  const correlationId = `crdiag-preview-${Date.now().toString(36)}`;
  const reliability = buildCoachReliabilityBody({
    sportCategory: "mlb",
    questionKind: "parlay_build",
    requestedLegCount: 5,
    returnedLegCount: delivered.length,
    durationMs: 12,
    realOddsAvailable: true,
    requestId: REQUEST_ID,
    affectedGame: GAME,
    correlationId,
    bakedSha: "c5246bc16fc4ac9a612c8402c9444e50b79a011e",
    updateId: "01a14add-f6a3-7a77-8960-41cab211cbe5",
    channel: "preview",
    picks: delivered,
    // Underfill is the honest outcome when default cap blocks a 5th seat.
    deliveryCommitted: delivered.length >= 5,
    candidateIds: delivered.map(
      (p) => `${p.game}|${p.market}|${p.pick}`.toLowerCase().slice(0, 120),
    ),
    gameIds: [GAME],
  });
  assert.ok(reliability, "reliability identity body required");
  assert.ok(
    reliability.eventType === "parlay_underfilled" ||
      reliability.eventType === "parlay_fulfilled",
    `unexpected eventType ${reliability.eventType}`,
  );
  assert.equal(reliability.correlationId, correlationId);
  assert.equal(reliability.requestId, REQUEST_ID);
  assert.equal(reliability.bakedSha, "c5246bc16fc4ac9a612c8402c9444e50b79a011e");

  const ticket = {
    ask: ASK,
    requestId: REQUEST_ID,
    baselineBake: "c5246bc16fc4ac9a612c8402c9444e50b79a011e",
    branch: "cursor/preview-cap-provenance-c5246-3645",
    requestedLegs: 5,
    deliveredCount: delivered.length,
    shortfall: Math.max(0, 5 - delivered.length),
    groundingRemovals: grounded.removedCount,
    progressiveRelaxation: progressiveLegsPerGameRelaxation(5),
    maxLegsPerGame: maxLegsPerGame(5),
    under65: {
      queryId: u65.id,
      line: u65.line,
      side: u65.totalSide,
      simHit: u65Hit,
      pushRate: coverPushRateForQuery(u65, sim),
      odds: -105,
      edgePp: simEdgeFromHit(u65Hit!, -105),
      evPct: simEvPct(u65Hit!, -105),
      edgeLabel: formatSimEdgePp(simEdgeFromHit(u65Hit!, -105)!),
      evLabel: formatSimEvPctLabel(simEvPct(u65Hit!, -105)!),
    },
    integerUnder7: {
      queryId: u7.id,
      simHit: hitRates[u7.id],
      pushRate: pushRates[u7.id],
      edgePpPushAware: simEdgeFromHit(hitRates[u7.id]!, -110, pushRates[u7.id]!),
      evPctPushAware: pushEv,
      evPctPushAsLoss: noPushEv,
    },
    deliveredPicks: delivered.map((p) => ({
      game: p.game,
      market: p.market,
      pick: p.pick,
      odds: p.odds,
      isProp: !!p.isProp,
      player: p.player ?? null,
      teamAbbr: p.teamAbbr ?? null,
      simHit: p.finalAiScore?.simHit ?? null,
      edgePct: p.finalAiScore?.edgePct ?? null,
      grade: p.finalAiScore?.grade ?? null,
      coverQueryId: buildGameCoverQuery(p)?.id ?? null,
    })),
    reliability,
  };

  writeFileSync(
    "/opt/cursor/artifacts/mlb-preview-cap-provenance-ticket.json",
    JSON.stringify(ticket, null, 2),
  );
  assert.ok(ticket.deliveredCount >= 2);
  assert.ok(ticket.shortfall >= 0);
  assert.deepEqual(ticket.progressiveRelaxation, []);
});

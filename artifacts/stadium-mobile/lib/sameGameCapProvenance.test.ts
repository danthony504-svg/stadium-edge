/**
 * Regressions for:
 * 1) Default same-game game-line cap preserved through ALT/refill (no progressive
 *    relax); honest shortfall; GT/TT same-side stack hard-block.
 * 2) Sim provenance: hit → edge (pp) / EV% recompute after odds change;
 *    withhold unverifiable grades; ALT total line buckets stay distinct.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import { wouldStackCorrelatedGameAndTeamTotals } from "./coachP0UnvalidatedTotals.ts";
import {
  attachSeatedSimProvenance,
  formatSimEdgePp,
  formatSimEvPctLabel,
  recomputeDerivedEdgeEv,
  simProvenanceIsVerifiable,
  withholdUnverifiableSeatedGrades,
} from "./coachSimProvenance.ts";
import { buildGameCoverQuery, gameLineLegBucket, gameSimHitForPick } from "./gameSimScoring.ts";
import { simEdgeFromHit, simEvPct } from "./gameSimQualityGates.ts";
import {
  maxLegsPerGame,
  progressiveLegsPerGameRelaxation,
  wouldExceedMaxLegsPerGame,
} from "./parlayCorrelationScore.ts";
import {
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

const GAME = "Tampa Bay Rays @ Cleveland Guardians";

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 70,
  edgePct: 12,
  simHit: 0.62,
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
    grade: "B+",
    confidencePct: 70,
    edgePct: 12,
  },
};

function scored(
  overrides: Partial<ParsedPick> & Pick<ParsedPick, "market" | "pick">,
  rank = 90,
): BoardScoredLeg {
  const pick: ParsedPick = {
    game: GAME,
    odds: -110,
    isProp: false,
    sport: "mlb",
    finalAiScore: { ...mainScore },
    ...overrides,
  };
  return {
    pick,
    evPct: 8,
    edgePct: pick.finalAiScore?.edgePct ?? 12,
    confidencePct: 70,
    impliedProbPct: 52.4,
    lineShoppingScore: null,
    grade: "B+",
    simHit: pick.finalAiScore?.simHit ?? 0.62,
    composite: 8,
    rankScore: rank,
  };
}

test("progressiveLegsPerGameRelaxation is disabled (no auto-raise)", () => {
  assert.deepEqual(progressiveLegsPerGameRelaxation(5), []);
  assert.deepEqual(progressiveLegsPerGameRelaxation(10), []);
  assert.deepEqual(progressiveLegsPerGameRelaxation(7), []);
  assert.deepEqual(
    progressiveLegsPerGameRelaxation(7, 4, { collegeTeamMarketStacks: true }),
    [],
  );
});

test("5-leg ask keeps default max 2 game-lines/game through top-up; honest shortfall", () => {
  assert.equal(maxLegsPerGame(5), 2);
  const short = [
    scored({ market: "Alt Spread", pick: "Guardians +1.5", odds: -186 }, 100).pick,
    scored({ market: "Total", pick: "Under 6.5", odds: -105 }, 95).pick,
  ];
  // Third game-line (Team Total) + props — progressive used to raise to 3 and seat TT.
  const pool: BoardScoredLeg[] = [
    scored({ market: "Alt Spread", pick: "Guardians +1.5", odds: -186 }, 100),
    scored({ market: "Total", pick: "Under 6.5", odds: -105 }, 95),
    scored({ market: "Team Total", pick: "Guardians Under 4.5", odds: -315 }, 94),
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
    ),
  ];
  const topped = topUpTicketFromQualifiedScored(short, pool, 5);
  const gameLines = topped.filter((p) => !p.isProp);
  assert.ok(gameLines.length <= 2, `expected ≤2 game-lines, got ${gameLines.length}`);
  assert.ok(
    !topped.some((p) => /team total/i.test(p.market) && /under/i.test(p.pick)),
    "same-side Team Total must not stack with game Under after default cap",
  );
  // Props may fill; ticket may still shortfall vs 5 if prop cap / correlation blocks.
  assert.ok(topped.length <= 5);
  for (const gl of gameLines) {
    assert.equal(
      wouldExceedMaxLegsPerGame(gl, gameLines.filter((x) => x !== gl), 2),
      false,
    );
  }
});

test("wouldStackCorrelatedGameAndTeamTotals blocks Under 6.5 + Guardians Under 4.5", () => {
  const total = { game: GAME, market: "Total", pick: "Under 6.5", isProp: false };
  const tt = {
    game: GAME,
    market: "Team Total",
    pick: "Guardians Under 4.5",
    isProp: false,
  };
  assert.equal(wouldStackCorrelatedGameAndTeamTotals(tt, [total]), true);
  assert.equal(wouldStackCorrelatedGameAndTeamTotals(total, [tt]), true);
  // Opposite side allowed.
  assert.equal(
    wouldStackCorrelatedGameAndTeamTotals(
      { game: GAME, market: "Team Total", pick: "Guardians Over 4.5", isProp: false },
      [total],
    ),
    false,
  );
});

test("gameLineLegBucket keeps ALT Under 4.5 distinct from main Under 6.5", () => {
  const main = gameLineLegBucket(GAME, "Total", "Under 6.5");
  const alt = gameLineLegBucket(GAME, "Alt Total", "Under 4.5");
  assert.notEqual(main, alt);
  assert.match(main, /under\|6\.5$/);
  assert.match(alt, /under\|4\.5$/);
});

test("recomputeDerivedEdgeEv separates pp edge from EV% after odds tick", () => {
  // simHit 0.835 @ −103 → ~+32.7 pp edge, ~+64.5% EV (not +42.1).
  const simHit = 0.835;
  const at103 = recomputeDerivedEdgeEv(simHit, -103);
  const at105 = recomputeDerivedEdgeEv(simHit, -105);
  assert.ok(at103.edgePct != null && at103.evPct != null);
  assert.ok(Math.abs(at103.edgePct! - 32.7) < 0.6, `edge@-103=${at103.edgePct}`);
  assert.ok(at103.evPct! > 60 && at103.evPct! < 70, `EV@-103=${at103.evPct}`);
  // Stale ALT Under 4.5 edge (+42.8) must not equal recomputed U6.5 edge.
  const staleAltEdge = simEdgeFromHit(0.714, 250)!;
  assert.ok(Math.abs(staleAltEdge - 42.8) < 0.5);
  assert.notEqual(Math.round(at103.edgePct!), Math.round(staleAltEdge));
  assert.ok(at105.edgePct != null && at105.edgePct! < at103.edgePct!);
  assert.equal(formatSimEdgePp(at103.edgePct!), `${at103.edgePct! >= 0 ? "+" : ""}${at103.edgePct!.toFixed(1)} pp`);
  assert.match(formatSimEvPctLabel(at103.evPct!), /% EV$/);
  assert.ok(!formatSimEdgePp(at103.edgePct!).includes("%"));
});

test("attachSeatedSimProvenance recomputes edge after odds substitution; withholds unverifiable", () => {
  const pick: ParsedPick = {
    game: GAME,
    market: "Total",
    pick: "Under 6.5",
    odds: -105,
    isProp: false,
    sport: "mlb",
    finalAiScore: {
      ...mainScore,
      simHit: 0.835,
      edgePct: 42.1, // stale / mis-associated (ALT U4.5-shaped)
      grade: "A-",
      confidencePct: 72,
    },
  };
  const seated = attachSeatedSimProvenance(pick, 0.835);
  assert.equal(seated.finalAiScore?.simHit, 0.835);
  const expected = simEdgeFromHit(0.835, -105)!;
  assert.equal(seated.finalAiScore?.edgePct, expected);
  assert.notEqual(seated.finalAiScore?.edgePct, 42.1);

  // Odds tick after substitution → recompute again.
  const reticked = attachSeatedSimProvenance({ ...seated, odds: -103 }, 0.835);
  assert.equal(reticked.finalAiScore?.edgePct, simEdgeFromHit(0.835, -103));
  assert.equal(simEvPct(0.835, -103), recomputeDerivedEdgeEv(0.835, -103).evPct);

  // Missing simHit → withhold grade.
  const withheld = attachSeatedSimProvenance(pick, null);
  assert.equal(withheld.finalAiScore?.simHit, null);
  assert.equal(withheld.finalAiScore?.grade, null);
  assert.equal(withheld.finalAiScore?.edgePct, null);
  assert.equal(simProvenanceIsVerifiable(withheld), false);
});

test("Under 6.5 cover query → sample hit → edge pp → card labels (not mean/stdev alone)", () => {
  // Exact cover-query identity (line + side) — distinct from ALT Under 4.5.
  const q = buildGameCoverQuery({
    game: GAME,
    market: "Total",
    pick: "Under 6.5",
    odds: -105,
    isProp: false,
    sport: "mlb",
  });
  assert.ok(q);
  assert.equal(q!.kind, "total");
  assert.equal(q!.totalSide, "under");
  assert.equal(q!.line, 6.5);

  const altQ = buildGameCoverQuery({
    game: GAME,
    market: "Alt Total",
    pick: "Under 4.5",
    odds: 250,
    isProp: false,
    sport: "mlb",
  });
  assert.ok(altQ);
  assert.notEqual(q!.id, altQ!.id);
  assert.notEqual(q!.line, altQ!.line);

  // Hit from coverHitRates — mean/stdev alone cannot establish this.
  const coverHit = 0.835;
  const pick: ParsedPick = {
    game: GAME,
    market: "Total",
    pick: "Under 6.5",
    odds: -105,
    isProp: false,
    sport: "mlb",
    finalAiScore: { ...mainScore, simHit: coverHit, edgePct: 42.1, grade: "A-" },
  };
  const hit = gameSimHitForPick(pick, {
    sport: "mlb",
    simulations: 10_000,
    homeWinProbability: 0.55,
    awayWinProbability: 0.45,
    tieProbability: 0,
    homeProjectedScore: 2.0,
    awayProjectedScore: 1.58,
    mostLikelyWinner: "home" as const,
    mostLikelyWinnerPct: 0.55,
    confidenceScore: 50,
    engineVersion: "sport-sim-v1",
    coverHitRates: { [q!.id]: coverHit, [altQ!.id]: 0.714 },
  });
  assert.equal(hit, coverHit);
  // Mean≈3.58 alone does not yield +42.1 pp @ −105; exact sample hit does ≈+32 pp.
  const edge = simEdgeFromHit(hit!, -105)!;
  const ev = simEvPct(hit!, -105)!;
  assert.ok(Math.abs(edge - 32.3) < 1.0, `edge=${edge}`);
  assert.ok(ev > 60, `ev=${ev}`);
  assert.notEqual(Math.round(edge), 42);
  const card = attachSeatedSimProvenance(pick, hit);
  assert.equal(card.finalAiScore?.edgePct, edge);
  assert.equal(formatSimEdgePp(edge), `${edge >= 0 ? "+" : ""}${edge.toFixed(1)} pp`);
  assert.match(formatSimEvPctLabel(ev), /% EV$/);
});

test("withholdUnverifiableSeatedGrades strips letter grades without simHit", () => {
  const picks: ParsedPick[] = [
    {
      game: GAME,
      market: "Total",
      pick: "Under 6.5",
      odds: -105,
      isProp: false,
      sport: "mlb",
      finalAiScore: {
        ...mainScore,
        simHit: null,
        grade: "B+",
        edgePct: 42.1,
      },
    },
  ];
  const out = withholdUnverifiableSeatedGrades(picks);
  assert.equal(out[0]!.finalAiScore?.grade, null);
  assert.equal(out[0]!.finalAiScore?.edgePct, null);
  assert.equal(out[0]!.finalAiScore?.simHit, null);
});

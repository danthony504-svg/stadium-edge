import { exactPropFixture } from "../test/exactPropFixture.ts";
import { emptyPickSubScores } from "./pickScore.ts";
/**
 * Cross-sport props-only quality floor + NHL phone regressions (Imama / Brady).
 *
 * Positive EV alone must never seat a prop below COACH_SIM_MIN_GRADE /
 * COACH_SIM_MIN_CONFIDENCE. No new I/O — pure gating + stat mapping.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  stageFootballPropsOnlyLegs,
} from "./coachFootballPropsOnly.ts";
import {
  gradeFootballPropFromHistory,
  type PropsOnlyHistorySlice,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  meetsCoachSimQualityFloor,
  simEdgeFromHit,
  simEvPct,
} from "./gameSimQualityGates.ts";
import {
  pickPassesTicketGate,
  propsOnlyTicketCleared,
} from "./pickRecommendation.ts";
import { gameValueForMarket } from "./propStats.ts";
import { impliedProb } from "./format.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const NONE = new Set<string>();

const SPORTS = [
  "nfl",
  "ncaaf",
  "nba",
  "wnba",
  "ncaab",
  "mlb",
  "nhl",
  "soccer",
] as const;

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeAtOrAboveFloor(grade: string): boolean {
  return (GRADE_RANK[grade] ?? -1) >= (GRADE_RANK[COACH_SIM_MIN_GRADE] ?? 99);
}

function propsPick(
  sport: string,
  market: string,
  player: string,
  line: number,
  odds: number,
  grade: string,
  conf: number,
  simHit: number,
): { pick: ParsedPick; score: BoardScoredLeg } {
  const edgePct = simEdgeFromHit(simHit, odds) ?? 0;
  const pick = exactPropFixture({
    // Unique game per player so per-game market+side caps do not starve the pool.
    game: `${sport} ${player} Away @ Home`,
    market,
    propMarketKey: market,
    pick: `${player} Over ${line}`,
    odds,
    isProp: true,
    player,
    propLine: line,
    propSide: "Over" as const,
    sport,
    athleteId: `ath-${player}`,
    propsOnlyTicket: true,
    ticketRole: "main" as const,
    finalAiScore: {
      grade,
      confidencePct: conf,
      edgePct,
      simHit,
      simAligned: simHit > impliedProb(odds),
      recommends: false,
      composite: GRADE_RANK[grade] ?? 0,
      highRiskValuePlay: false,
      factors: [],
      rubric: { composite: null, grade: null, confidencePct: null, edgePct: null, scores: emptyPickSubScores() },
    },
  } as ParsedPick);
  const scored: BoardScoredLeg = {
    pick,
    evPct: simEvPct(simHit, odds),
    edgePct,
    confidencePct: conf,
    impliedProbPct: Math.round(impliedProb(odds) * 1000) / 10,
    lineShoppingScore: null,
    grade,
    simHit,
    composite: GRADE_RANK[grade] ?? 0,
    rankScore: GRADE_RANK[grade] ?? 0,
  } as BoardScoredLeg;
  return { pick, score: scored };
}

test("meetsCoachSimQualityFloor matches COACH_SIM_MIN_GRADE / CONFIDENCE policy", () => {
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  for (const g of ["A+", "A", "B", "C+", "C", "D", "F"] as const) {
    const ok = gradeAtOrAboveFloor(g);
    assert.equal(
      meetsCoachSimQualityFloor({ grade: g, confidencePct: 52 }),
      ok,
      `grade ${g}`,
    );
  }
  assert.equal(meetsCoachSimQualityFloor({ grade: "B", confidencePct: 51 }), false);
  assert.equal(meetsCoachSimQualityFloor({ grade: "B", confidencePct: 52 }), true);
});

test("cross-sport props-only: C/D/F rejected; A+/A/B/C+ seat when EV+conf pass", () => {
  for (const sport of SPORTS) {
    const market =
      sport === "mlb"
        ? "batter_hits"
        : sport === "nhl"
          ? "player_shots_on_goal"
          : sport === "soccer"
            ? "player_shots_on_target"
            : sport === "nfl" || sport === "ncaaf"
              ? "player_reception_yds"
              : "player_points";
    const line = sport === "nhl" || sport === "soccer" || sport === "mlb" ? 1.5 : 20.5;

    for (const grade of ["A+", "A", "B", "C+", "C", "D", "F"] as const) {
      const { pick, score } = propsPick(
        sport,
        market,
        `${sport}-${grade}`,
        line,
        -110,
        grade,
        60,
        0.62,
      );
      const cleared = propsOnlyTicketCleared(pick, pick.finalAiScore);
      const staged = stageFootballPropsOnlyLegs([score], 1);
      const expectSeat = gradeAtOrAboveFloor(grade);
      assert.equal(cleared, expectSeat, `${sport} ${grade} propsOnlyTicketCleared`);
      assert.equal(
        staged.length === 1,
        expectSeat,
        `${sport} ${grade} stage length=${staged.length}`,
      );
      if (!expectSeat) {
        assert.equal(pickPassesTicketGate(pick, pick.finalAiScore), false);
      }
    }
  }
});

test("Imama O1.5 Goals +16000 F/~2% rejected; honest shortfall when pool is weak", () => {
  const simHit = 0.02;
  const odds = 16000;
  const edgePct = simEdgeFromHit(simHit, odds)!;
  assert.ok(Math.abs(edgePct - 1.4) < 0.05, `edge ${edgePct}`);

  const weakPool: BoardScoredLeg[] = [];
  for (let i = 0; i < 8; i++) {
    const { score } = propsPick(
      "nhl",
      "player_goals",
      `ImamaLike${i}`,
      1.5,
      14000 + i * 250,
      "F",
      52,
      0.02 + i * 0.001,
    );
    weakPool.push(score);
  }
  // One barely-positive EV F-grade Brady-style under that also fails grade floor.
  const bradyFake = propsPick("nhl", "player_points", "BradyFake", 0.5, 125, "F", 52, 0.98);
  bradyFake.pick.propSide = "Under";
  bradyFake.pick.pick = "BradyFake Under 0.5 Points";
  bradyFake.score.pick = bradyFake.pick;
  weakPool.push(bradyFake.score);

  const staged = stageFootballPropsOnlyLegs(weakPool, 8);
  assert.equal(staged.length, 0, "lottery F-grades must not fill an 8-leg ticket");
  assert.ok(staged.length < 8, "honest shortfall when no legitimate seats");

  const imama = propsPick("nhl", "player_goals", "Bokondji Imama", 1.5, 16000, "F", 52, 0.02);
  assert.equal(propsOnlyTicketCleared(imama.pick, imama.pick.finalAiScore), false);
  assert.equal(pickPassesTicketGate(imama.pick, imama.pick.finalAiScore), false);
});

test("Imama-class reject; qualified NHL props still seat up to target", () => {
  const pool: BoardScoredLeg[] = [];
  // 3 lottery F goal ladders
  for (let i = 0; i < 3; i++) {
    pool.push(
      propsPick("nhl", "player_goals", `Lottery${i}`, 1.5, 16000, "F", 52, 0.02).score,
    );
  }
  // 8 legitimate skaters (shots) at C+/B with real edge
  for (let i = 0; i < 8; i++) {
    pool.push(
      propsPick(
        "nhl",
        "player_shots_on_goal",
        `Skater${i}`,
        2.5,
        -115,
        i % 2 === 0 ? "B" : "C+",
        58,
        0.61,
      ).score,
    );
  }
  const staged = stageFootballPropsOnlyLegs(pool, 8);
  assert.equal(staged.length, 8);
  assert.ok(staged.every((p) => p.propMarketKey === "player_shots_on_goal"));
  assert.ok(
    staged.every((p) => {
      const g = p.finalAiScore?.grade ?? "";
      return gradeAtOrAboveFloor(g);
    }),
  );
});

test("Brady Tkachuk: real NHL P history — no zero-fill; missing fails closed", () => {
  // Missing PTS/P → null values → ungradeable (not 98%).
  const missingHist: PropsOnlyHistorySlice = {
    recent: Array.from({ length: 8 }, () => ({
      stats: { G: "1", A: "1" }, // production present but points field absent
    })),
  };
  const underPick = {
    isProp: true,
    sport: "nhl",
    player: "Brady Tkachuk",
    athleteId: "brady-1",
    propMarketKey: "player_points",
    market: "Points",
    propLine: 0.5,
    propSide: "Under",
    odds: 125,
    game: "OTT @ MTL",
    pick: "Brady Tkachuk Under 0.5 Points",
  } as ParsedPick;

  const missingGrade = gradeFootballPropFromHistory(underPick, missingHist, {
    marketKey: "player_points",
    line: 0.5,
  });
  assert.equal(missingGrade.hitProbability, null);
  assert.notEqual(missingGrade.hitProbability, 0.98);

  // Blank P/PTS must not become 0.
  assert.equal(gameValueForMarket("player_points", { P: "" }, NONE), null);
  assert.equal(gameValueForMarket("player_points", { PTS: "" }, NONE), null);

  // Genuine all-zero games (field present) may still yield high Under hit — but
  // that requires an explicit "0", not a missing column.
  const zeroHist: PropsOnlyHistorySlice = {
    recent: Array.from({ length: 8 }, () => ({ stats: { P: "0", G: "0", A: "0" } })),
  };
  const zeroGrade = gradeFootballPropFromHistory(underPick, zeroHist, {
    marketKey: "player_points",
    line: 0.5,
  });
  assert.equal(zeroGrade.hitProbability, null, "unvalidated history must not become a seated probability");
  assert.ok(zeroHist.recent?.every(g => gameValueForMarket("player_points", g.stats ?? {}, NONE) === 0));

  // Realistic Brady-like production via NHL P — Under 0.5 must not be ~98%.
  const realHist: PropsOnlyHistorySlice = {
    recent: [
      { stats: { P: "2", G: "1", A: "1" } },
      { stats: { P: "1", G: "0", A: "1" } },
      { stats: { P: "0", G: "0", A: "0" } },
      { stats: { P: "3", G: "1", A: "2" } },
      { stats: { P: "1", G: "1", A: "0" } },
      { stats: { P: "2", G: "0", A: "2" } },
      { stats: { P: "0", G: "0", A: "0" } },
      { stats: { P: "1", G: "0", A: "1" } },
    ],
  };
  // Mapping: G+A identity when P present
  assert.equal(gameValueForMarket("player_points", realHist.recent![0]!.stats!, NONE), 2);
  const realGrade = gradeFootballPropFromHistory(underPick, realHist, {
    marketKey: "player_points",
    line: 0.5,
  });
  assert.equal(realGrade.hitProbability, null);
  assert.equal(realGrade.probabilityProvenance?.source, "insufficient_evidence");
  const observed = realHist.recent!.map(g => gameValueForMarket("player_points", g.stats ?? {}, NONE));
  assert.equal(observed.filter(v => v != null && v < 0.5).length, 2);
  const seatedEdge = realGrade.hitProbability == null ? null : simEdgeFromHit(realGrade.hitProbability, 125);
  assert.equal(seatedEdge, null, "unvalidated history cannot manufacture a positive edge");
});

test("plain N-leg / player-props asks are not longshot-style grade exemptions", () => {
  // Even with propsOnlyTicket, F + tiny sim cannot clear — longshot words are a
  // separate style path; this gate stays on COACH_SIM_MIN_GRADE for props-only.
  for (const sport of SPORTS) {
    const { pick } = propsPick(sport, "player_points", "LongshotFill", 0.5, 10000, "F", 52, 0.03);
    assert.equal(propsOnlyTicketCleared(pick, pick.finalAiScore), false, sport);
  }
});

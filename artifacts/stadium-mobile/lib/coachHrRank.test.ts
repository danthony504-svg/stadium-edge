import assert from "node:assert/strict";
import test from "node:test";
import {
  COACH_HR_RANK_WEIGHTS,
  batterPowerFromRealData,
  buildCoachHrRankComponents,
  coachHrRankScore,
  filterHrScorerPoolEntries,
  hrBoardPrescoreRank,
  hrSelectionDiagnostics,
  isBatterHomeRunMarket,
  isBatterHomeRunPick,
  isHrAnytimeLine,
  isHrOnlyScoredPool,
  isHrScorerSide,
  selectTopHrQualifiedLegs,
} from "./coachHrRank.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function hrPick(
  overrides: Partial<ParsedPick> & { player: string; game: string; odds: number },
): ParsedPick {
  const simHit = overrides.finalAiScore?.simHit ?? 0.4;
  return {
    game: overrides.game,
    market: "Home Runs",
    pick: `${overrides.player} Over 0.5`,
    odds: overrides.odds,
    isProp: true,
    player: overrides.player,
    athleteId: overrides.athleteId ?? overrides.player.replace(/\s+/g, "").toLowerCase(),
    propMarketKey: "batter_home_runs",
    propLine: 0.5,
    propSide: "Over",
    finalAiScore: {
      composite: 7.5,
      grade: "B+",
      confidencePct: 62,
      edgePct: 8,
      simHit,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: { matchup: 7, trend: 7, injury: 6, lineShopping: 6, lineValue: 7 },
        composite: 7.5,
        grade: "B+",
        confidencePct: 62,
        edgePct: 8,
      },
      propHolistic: {
        composite: 7.5,
        grade: "B+",
        confidencePct: 62,
        coveragePct: 0.75,
        missingCount: 1,
        applicableCount: 6,
        factors: [],
        recommends: true,
      },
      ...(overrides.finalAiScore ?? {}),
    },
    ...overrides,
  } as ParsedPick;
}

function scored(pick: ParsedPick, rankScore: number): BoardScoredLeg {
  return {
    pick,
    evPct: 10,
    edgePct: 8,
    confidencePct: 62,
    impliedProbPct: 25,
    lineShoppingScore: 6,
    grade: "B+",
    simHit: pick.finalAiScore?.simHit ?? 0.4,
    composite: 7.5,
    rankScore,
  };
}

test("isBatterHomeRunMarket recognizes HR keys only", () => {
  assert.equal(isBatterHomeRunMarket("batter_home_runs"), true);
  assert.equal(isBatterHomeRunMarket("batter_home_runs_alternate"), true);
  assert.equal(isBatterHomeRunMarket("pitcher_strikeouts"), false);
  assert.equal(isBatterHomeRunPick(hrPick({ player: "X", game: "A @ B", odds: 250 })), true);
});

test("COACH_HR_RANK_WEIGHTS favor sim + matchup over EV", () => {
  const sum = Object.values(COACH_HR_RANK_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(COACH_HR_RANK_WEIGHTS.hrProbability > COACH_HR_RANK_WEIGHTS.marketEv);
  assert.ok(COACH_HR_RANK_WEIGHTS.matchupQuality > COACH_HR_RANK_WEIGHTS.marketEv);
});

test("batterPowerFromRealData never invents Statcast — lists missing", () => {
  const thin = batterPowerFromRealData(null, null);
  assert.equal(thin.score01, null);
  assert.ok(thin.missing.includes("barrel_rate"));
  assert.ok(thin.missing.includes("exit_velocity"));
  assert.ok(thin.missing.includes("iso"));
});

test("batterPowerFromRealData uses real platoon OPS when present", () => {
  const rich = batterPowerFromRealData(null, {
    platoon: "advantage",
    vsThatHand: { ops: 0.95, slg: 0.55, hr: 18 },
  });
  assert.ok(rich.score01 != null && rich.score01 > 0.5);
  assert.ok(rich.present.some((p) => p.includes("ops")));
});

test("higher sim HR probability outranks longshot EV alone", () => {
  const solid = buildCoachHrRankComponents({
    pick: hrPick({ player: "Solid", game: "NYY @ BOS", odds: -110 }),
    simHit: 0.42,
    evPct: 4,
    platoon: {
      platoon: "advantage",
      opposingPitcherTendency: {
        hrPer9: 1.55,
        flyBallPct: 0.46,
        barrelPctAllowed: 10,
        hardHitPctAllowed: 43,
        battedBallEvents: 150,
      },
      vsThatHand: { ops: 0.93, slg: 0.55, hr: 22 },
    },
    gameEnv: {
      park: { hrIndex: 112, dome: false },
      weather: { tempF: 78, windMph: 9 },
    },
  });
  const longshot = buildCoachHrRankComponents({
    pick: hrPick({ player: "Longshot", game: "NYY @ BOS", odds: 900 }),
    simHit: 0.07,
    evPct: 28,
    platoon: {
      platoon: "disadvantage",
      vsThatHand: { ops: 0.6, slg: 0.3, hr: 3 },
    },
    gameEnv: {
      park: { hrIndex: 90, dome: false },
      weather: { tempF: 46, windMph: 3 },
    },
  });
  assert.ok(solid.rankScore > longshot.rankScore);
});

test("selectTopHrQualifiedLegs keeps independently top same-game hitters", () => {
  const a = scored(hrPick({ player: "A", game: "NYY @ BOS", odds: 300, athleteId: "1" }), 90);
  const b = scored(hrPick({ player: "B", game: "NYY @ BOS", odds: 320, athleteId: "2" }), 88);
  const c = scored(hrPick({ player: "C", game: "LAD @ SD", odds: 280, athleteId: "3" }), 70);
  const d = scored(hrPick({ player: "D", game: "NYY @ BOS", odds: 400, athleteId: "4" }), 55);
  const picks = selectTopHrQualifiedLegs([a, b, c, d], 3);
  assert.deepEqual(
    picks.map((p) => p.player),
    ["A", "B", "C"],
  );
});

test("selectTopHrQualifiedLegs returns shortfall instead of padding", () => {
  const only = scored(hrPick({ player: "Only", game: "NYY @ BOS", odds: 250, athleteId: "9" }), 80);
  const picks = selectTopHrQualifiedLegs([only], 3);
  assert.equal(picks.length, 1);
});

test("hrSelectionDiagnostics explains next-best gap", () => {
  const a = scored(hrPick({ player: "A", game: "NYY @ BOS", odds: 300, athleteId: "1" }), 90);
  const b = scored(hrPick({ player: "B", game: "LAD @ SD", odds: 320, athleteId: "2" }), 60);
  const selected = selectTopHrQualifiedLegs([a, b], 1);
  const diag = hrSelectionDiagnostics([a, b], selected, new Map());
  assert.equal(diag.selected.length, 1);
  assert.equal(diag.nextBest.length, 1);
  assert.ok(diag.nextBest[0]!.whyBehind.includes("rank"));
});

test("isHrOnlyScoredPool", () => {
  const a = scored(hrPick({ player: "A", game: "NYY @ BOS", odds: 300 }), 80);
  assert.equal(isHrOnlyScoredPool([a]), true);
});

test("HR scorer filters drop Unders and prefer anytime Over 0.5", () => {
  const over = hrPick({ player: "A", game: "NYY @ BOS", odds: 400 });
  const under: ParsedPick = {
    ...over,
    player: "B",
    athleteId: "b",
    propSide: "Under",
    pick: "B Under 0.5",
  };
  const multi: ParsedPick = {
    ...over,
    player: "C",
    athleteId: "c",
    propLine: 1.5,
    pick: "C Over 1.5",
  };
  assert.equal(isHrScorerSide(over), true);
  assert.equal(isHrScorerSide(under), false);
  assert.equal(isHrAnytimeLine(over), true);
  assert.equal(isHrAnytimeLine(multi), false);
  assert.equal(filterHrScorerPoolEntries([{ side: "Over" }, { side: "Under" }]).length, 1);
  assert.ok(hrBoardPrescoreRank(over) > hrBoardPrescoreRank(multi));
});

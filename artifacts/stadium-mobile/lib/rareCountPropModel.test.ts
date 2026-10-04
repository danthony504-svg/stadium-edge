/**
 * Rare-count HR / multi-goal probability + ranking regression tests.
 *
 * Phone: Over 1.5 HR longshots (+22500…+30000) staged on "7 leg for today"
 * because a 0/10 sample floored to 2% and a 1×2-HR game made Over 0.5 and
 * Over 1.5 share the same empirical rate → fake multi-thousand % EV.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  gradeFootballPropFromHistory,
  propsOnlyEvPct,
  propsOnlyLegClearsOdds,
  type PropsOnlyHistorySlice,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  comparePropsOnlyLegsByReliableEv,
  propsOnlyReliabilityWeightedEv,
  stageFootballPropsOnlyLegs,
} from "./coachFootballPropsOnly.ts";
import {
  isRareCountPropMarket,
  isRareMultiCountOver,
  meanCount,
  poissonPAtLeast,
  rareCountEvRankWeight,
  rareCountHitFromValues,
  rareCountHitReliability,
  rareCountThresholdK,
} from "./rareCountPropModel.ts";
import { clipPropSimHitForGrade } from "./simMarketSupport.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function hrHist(values: number[]): PropsOnlyHistorySlice {
  return {
    recent: values.map((hr) => ({ stats: { HR: String(hr) } })),
  };
}

function hrPick(opts: {
  player: string;
  line: number;
  odds: number;
  game?: string;
  athleteId?: string;
}): ParsedPick {
  return {
    isProp: true,
    sport: "mlb",
    player: opts.player,
    athleteId: opts.athleteId ?? "1",
    propMarketKey: "batter_home_runs",
    market: "Home Runs",
    propLine: opts.line,
    propSide: "Over",
    odds: opts.odds,
    game: opts.game ?? "Padres @ Brewers",
    pick: `${opts.player} Over ${opts.line} Home Runs`,
  } as ParsedPick;
}

test("rareCountThresholdK: Over 0.5→1, 1.5→2, 2.5→3", () => {
  assert.equal(rareCountThresholdK(0.5), 1);
  assert.equal(rareCountThresholdK(1.5), 2);
  assert.equal(rareCountThresholdK(2.5), 3);
});

test("isRareCountPropMarket covers HR / SB / goals, not yards", () => {
  assert.equal(isRareCountPropMarket("batter_home_runs"), true);
  assert.equal(isRareCountPropMarket("batter_home_runs_alternate"), true);
  assert.equal(isRareCountPropMarket("batter_stolen_bases"), true);
  assert.equal(isRareCountPropMarket("player_goals"), true);
  assert.equal(isRareCountPropMarket("player_reception_yds"), false);
  assert.equal(isRareCountPropMarket("player_pass_yds"), false);
});

test("Over 0.5 HR and Over 1.5 HR produce threshold-specific probabilities", () => {
  // One 2-HR game in 10 — empirical rate was identical (0.1) for both lines.
  const vals = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0];
  const p05 = rareCountHitFromValues(vals, 0.5, "Over");
  const p15 = rareCountHitFromValues(vals, 1.5, "Over");
  assert.ok(p05 != null && p15 != null);
  assert.ok(p05! > p15!, `Over 0.5 (${p05}) must exceed Over 1.5 (${p15})`);
  const lambda = meanCount(vals);
  assert.ok(Math.abs(p05! - poissonPAtLeast(lambda, 1)) < 1e-9);
  assert.ok(Math.abs(p15! - poissonPAtLeast(lambda, 2)) < 1e-9);
});

test("0 historical hits does not become a fake 2% probability", () => {
  const zeros = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(rareCountHitFromValues(zeros, 1.5, "Over"), null);
  assert.equal(rareCountHitFromValues(zeros, 0.5, "Over"), null);
  assert.equal(clipPropSimHitForGrade({ propMarketKey: "batter_home_runs", propLine: 1.5 }, 0), null);

  const graded = gradeFootballPropFromHistory(
    hrPick({ player: "Dustin Harris", line: 1.5, odds: 25000 }),
    hrHist(zeros),
    { marketKey: "batter_home_runs", line: 1.5 },
  );
  assert.equal(graded.hitProbability, null);
  assert.notEqual(graded.hitProbability, 0.02);
});

test("gradeFootballPropFromHistory: Cronenworth-style 1×2HR does not inflate Over 1.5 to 10%", () => {
  const vals = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0];
  const over05 = gradeFootballPropFromHistory(
    hrPick({ player: "Jake Cronenworth", line: 0.5, odds: 400 }),
    hrHist(vals),
    { marketKey: "batter_home_runs", line: 0.5 },
  );
  const over15 = gradeFootballPropFromHistory(
    hrPick({ player: "Jake Cronenworth", line: 1.5, odds: 30000 }),
    hrHist(vals),
    { marketKey: "batter_home_runs", line: 1.5 },
  );
  assert.ok(over05.hitProbability != null);
  assert.ok(over15.hitProbability != null);
  assert.ok(over05.hitProbability! > over15.hitProbability!);
  // Must not reuse the empirical 0.1 rate for Over 1.5.
  assert.ok(over15.hitProbability! < 0.05, `got ${over15.hitProbability}`);
  assert.ok((over15.hitReliability ?? 0) < 0.6);
});

test("extreme odds alone cannot manufacture high-confidence/high-ranking EV", () => {
  const vals = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0];
  const hr = hrPick({ player: "Jake Cronenworth", line: 1.5, odds: 30000 });
  const graded = gradeFootballPropFromHistory(hr, hrHist(vals), {
    marketKey: "batter_home_runs",
    line: 1.5,
  });
  const yards = {
    isProp: true,
    sport: "ncaaf",
    player: "Jayden McGowan",
    athleteId: "2",
    propMarketKey: "player_reception_yds",
    market: "Rec Yds",
    propLine: 69.5,
    propSide: "Over" as const,
    odds: 578,
    game: "Baylor @ Arizona State",
    pick: "Jayden McGowan Over 69.5 Rec Yds",
  } as ParsedPick;

  const hrLeg = {
    pick: hr,
    simHit: graded.hitProbability,
    evPct: propsOnlyEvPct(hr, graded.hitProbability),
    hitReliability: graded.hitReliability ?? 0.2,
    rankScore: 5,
    edgePct: null,
    confidencePct: 52,
    impliedProbPct: null,
    lineShoppingScore: null,
    grade: "C-",
    composite: 5,
  } as BoardScoredLeg;

  const yardsLeg = {
    pick: yards,
    simHit: 0.6667,
    evPct: 352,
    hitReliability: 1,
    rankScore: 11,
    edgePct: 52,
    confidencePct: 52,
    impliedProbPct: 14.7,
    lineShoppingScore: null,
    grade: "A-",
    composite: 8,
  } as BoardScoredLeg;

  assert.ok(
    propsOnlyReliabilityWeightedEv(yardsLeg) > propsOnlyReliabilityWeightedEv(hrLeg),
    "yards with solid hit must outrank weak HR longshot after reliability weight",
  );
  assert.ok(comparePropsOnlyLegsByReliableEv(yardsLeg, hrLeg) < 0);
  assert.ok(rareCountEvRankWeight(graded.hitReliability) < 0.5);
});

test("generic 7-leg staging diversifies same-event rare HR family", () => {
  const game = "San Diego Padres @ Milwaukee Brewers";
  const hrScored: BoardScoredLeg[] = [];
  const names = ["Salas", "Cronenworth", "Campusano", "Ortiz", "Lara", "Pratt", "Yelich"];
  for (let i = 0; i < names.length; i++) {
    hrScored.push({
      pick: hrPick({
        player: names[i]!,
        line: 1.5,
        odds: 30000 - i * 1000,
        game,
        athleteId: String(10 + i),
      }),
      // Clears odds vs extreme longshot implied; reliability stays weak.
      simHit: 0.03,
      evPct: 500 - i,
      hitReliability: 0.25,
      rankScore: 5,
      edgePct: 2,
      confidencePct: 52,
      impliedProbPct: 0.3,
      lineShoppingScore: null,
      grade: "F",
      composite: 3,
    } as BoardScoredLeg);
  }
  // Mixed board: HR longshots + ordinary yards from other games.
  const mixed: BoardScoredLeg[] = [...hrScored];
  for (let i = 0; i < 6; i++) {
    mixed.push({
      pick: {
        isProp: true,
        sport: "ncaaf",
        player: `WR${i}`,
        athleteId: `wr-${i}`,
        propMarketKey: "player_reception_yds",
        market: "Rec Yds",
        propLine: 40.5 + i,
        propSide: "Over",
        odds: -110,
        game: `Game ${i} A @ Game ${i} B`,
        pick: `WR${i} Over ${40.5 + i} Rec Yds`,
      } as ParsedPick,
      simHit: 0.55,
      evPct: 20 + i,
      hitReliability: 1,
      rankScore: 8,
      edgePct: 10,
      confidencePct: 60,
      impliedProbPct: 52,
      lineShoppingScore: null,
      grade: "B",
      composite: 7,
    } as BoardScoredLeg);
  }

  const generic = stageFootballPropsOnlyLegs(mixed, 7);
  const hrOnTicket = generic.filter((p) =>
    isRareCountPropMarket(p.propMarketKey ?? p.market),
  );
  assert.ok(hrOnTicket.length <= 1, `generic ticket rare HR seats=${hrOnTicket.length}`);

  // Explicit HR board: only rare-family candidates, stacking allowed.
  const explicit = stageFootballPropsOnlyLegs(hrScored, 5, undefined, {
    allowRareCountFamilyStack: true,
  });
  const hrExplicit = explicit.filter((p) =>
    isRareCountPropMarket(p.propMarketKey ?? p.market),
  );
  assert.ok(
    hrExplicit.length >= 2,
    `explicit HR ask must allow multiple rare seats, got ${hrExplicit.length}`,
  );
});

test("provider line/odds untouched; normal yards EV gate intact", () => {
  const yards = {
    isProp: true,
    sport: "ncaaf",
    player: "Jayden McGowan",
    athleteId: "2",
    propMarketKey: "player_reception_yds",
    market: "Rec Yds",
    propLine: 69.5,
    propSide: "Over" as const,
    odds: 578,
    game: "Baylor @ Arizona State",
    pick: "Jayden McGowan Over 69.5 Rec Yds",
  } as ParsedPick;
  assert.equal(yards.propLine, 69.5);
  assert.equal(yards.odds, 578);
  assert.equal(propsOnlyLegClearsOdds(yards, 0.6667), true);
  assert.equal(propsOnlyLegClearsOdds(yards, 0.1), false);
  assert.equal(isRareMultiCountOver({ market: "batter_home_runs", line: 1.5, side: "Over" }), true);
  assert.equal(isRareMultiCountOver({ market: "batter_home_runs", line: 0.5, side: "Over" }), false);
});

test("rareCountHitReliability: multi-count Over needs real threshold support", () => {
  const thin = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0];
  const solid = [1, 0, 2, 1, 0, 1, 2, 0, 1, 1];
  const rThin = rareCountHitReliability(thin, 1.5, "Over");
  const rSolid = rareCountHitReliability(solid, 1.5, "Over");
  assert.ok(rSolid > rThin);
  assert.ok(rThin < 0.5);
});

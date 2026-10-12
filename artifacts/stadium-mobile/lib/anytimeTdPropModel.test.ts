/**
 * Anytime TD market-quality regressions — P(≥1), shrinkage, no 2% floor,
 * opportunity caps, market sanity, NFL/NCAAF equivalence.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANYTIME_TD_PRIOR_MEAN,
  ANYTIME_TD_PRIOR_STRENGTH,
  anytimeTdCalibrateToMarket,
  anytimeTdHitFromValues,
  anytimeTdMarketDisagreementExtreme,
  anytimeTdNormalSeatAllowed,
  capAnytimeTdOpportunityBump,
  isAnytimeTdPropMarket,
  poissonLambdaFromPAtLeastOne,
  poissonPAtLeastOneFromLambda,
} from "./anytimeTdPropModel.ts";
import { clipPropSimHitForGrade } from "./simMarketSupport.ts";
import { gradeFootballPropFromHistory } from "./coachFootballPropsOnlyGrade.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import { propsOnlyTicketCleared } from "./pickRecommendation.ts";
import { impliedProb } from "./format.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

test("isAnytimeTdPropMarket covers NFL/NCAAF keys", () => {
  assert.equal(isAnytimeTdPropMarket("player_anytime_td"), true);
  assert.equal(isAnytimeTdPropMarket("Anytime TD"), true);
  assert.equal(isAnytimeTdPropMarket("player_pass_yds"), false);
  assert.equal(isAnytimeTdPropMarket("player_first_td"), false);
  assert.equal(isAnytimeTdPropMarket("batter_home_runs"), false);
});

test("P(at least one) uses binary scoring — multi-TD game ≠ multiple hits", () => {
  // One 2-TD game in 5 → binary rate 1/5 = 20%; count-mean λ=0.4 → Poisson ~33%.
  const vals = [2, 0, 0, 0, 0];
  const td = anytimeTdHitFromValues(vals, "Over");
  assert.equal(td.scoreHits, 1);
  assert.ok(Math.abs(td.rawScoreRate - 0.2) < 1e-9);
  assert.ok(td.countMeanLambda > 0.39 && td.countMeanLambda < 0.41);
  assert.ok(td.poissonFromCountMean > 0.3, "count-mean Poisson overstates");
  // Shrunk binary must stay below inflated Poisson-from-count.
  assert.ok(td.hit != null && td.hit < td.poissonFromCountMean);
  assert.ok(td.hit! < 0.28, `binary-shrunk=${td.hit}`);
});

test("Poisson conversion: λ = −ln(1−p) recovers P(X≥1)", () => {
  for (const p of [0.1, 0.18, 0.3, 0.5, 0.7]) {
    const lam = poissonLambdaFromPAtLeastOne(p);
    const back = poissonPAtLeastOneFromLambda(lam);
    assert.ok(Math.abs(back - p) < 1e-9, `p=${p} lam=${lam} back=${back}`);
  }
});

test("sample shrinkage: 0/5, 1/5, 3/5, 5/5", () => {
  const alpha = ANYTIME_TD_PRIOR_STRENGTH * ANYTIME_TD_PRIOR_MEAN;
  const beta = ANYTIME_TD_PRIOR_STRENGTH * (1 - ANYTIME_TD_PRIOR_MEAN);
  const expect = (hits: number, n: number) => (hits + alpha) / (n + alpha + beta);

  const z = anytimeTdHitFromValues([0, 0, 0, 0, 0], "Over");
  assert.ok(z.hit != null);
  assert.ok(Math.abs(z.hit! - expect(0, 5)) < 1e-9);
  assert.ok(z.hit! > 0.05 && z.hit! < 0.12, `0/5 shrunk=${z.hit}`);
  assert.ok(z.reliability < 0.4);

  const one = anytimeTdHitFromValues([1, 0, 0, 0, 0], "Over");
  assert.ok(Math.abs(one.hit! - expect(1, 5)) < 1e-9);
  assert.ok(one.hit! > 0.15 && one.hit! < 0.25);

  const three = anytimeTdHitFromValues([1, 1, 1, 0, 0], "Over");
  assert.ok(Math.abs(three.hit! - expect(3, 5)) < 1e-9);
  assert.ok(three.hit! > 0.35 && three.hit! < 0.5);

  const five = anytimeTdHitFromValues([1, 1, 1, 1, 1], "Over");
  assert.ok(Math.abs(five.hit! - expect(5, 5)) < 1e-9);
  // Must NOT soft-clip to 0.98 — thin perfect samples stay shrunk.
  assert.ok(five.hit! < 0.75, `5/5 must shrink, got ${five.hit}`);
  assert.notEqual(five.hit, 0.98);
});

test("no generic 2% floor manufactures TD edge at long odds", () => {
  const td = { propMarketKey: "player_anytime_td", propLine: 0.5, market: "Anytime TD" };
  assert.equal(clipPropSimHitForGrade(td, 0), null);
  assert.equal(clipPropSimHitForGrade(td, 1), 0.95);

  // 0/5 shrink ~8% — still well below inventing edge at +80000 via 2% floor math
  // that used to clear EV with manufactured C+.
  const z = anytimeTdHitFromValues([0, 0, 0, 0, 0], "Over");
  const odds = 80000;
  const implied = impliedProb(odds);
  assert.ok(z.hit! > implied, "prior can exceed ultra-long implied");
  // But seating must fail closed on thin reliability + extreme disagreement.
  assert.equal(
    anytimeTdNormalSeatAllowed(
      { isProp: true, propMarketKey: "player_anytime_td", odds },
      { hitReliability: z.reliability, simHit: z.hit, odds },
    ),
    false,
  );
});

test("+775 with ~30% model is extreme disagreement — needs strong reliability", () => {
  const odds = 775;
  const implied = impliedProb(odds);
  assert.ok(implied > 0.11 && implied < 0.12, `implied=${implied}`);
  assert.equal(anytimeTdMarketDisagreementExtreme(0.3, odds), true);

  // Thin 1/5-style reliability cannot seat.
  assert.equal(
    anytimeTdNormalSeatAllowed(
      { isProp: true, propMarketKey: "player_anytime_td", odds },
      { hitReliability: 0.25, simHit: 0.3, odds },
    ),
    false,
  );

  // Calibration pulls thin evidence toward the book.
  const cal = anytimeTdCalibrateToMarket(0.3, odds, 0.25);
  assert.ok(cal < 0.3 && cal > implied, `calibrated=${cal}`);

  // Strong reliability may seat (still needs C+/52%/EV via qualify).
  assert.equal(
    anytimeTdNormalSeatAllowed(
      { isProp: true, propMarketKey: "player_anytime_td", odds },
      { hitReliability: 0.7, simHit: 0.3, odds },
    ),
    true,
  );
});

test("-115 with 70–80% raw empirical is shrunk — not auto-defensible from 5/5", () => {
  const odds = -115;
  const implied = impliedProb(odds);
  assert.ok(implied > 0.52 && implied < 0.55);

  // Before: empirical 5/5 → soft-clip 0.98. After: shrunk ~0.64.
  const five = anytimeTdHitFromValues([2, 1, 1, 1, 1], "Over");
  assert.ok(five.rawScoreRate === 1);
  assert.ok(five.hit! < 0.75, `shrunk=${five.hit}`);
  assert.ok(five.hit! > implied, "still above -115 implied when truly scoring every game");

  // 3/5 is closer to market after shrink.
  const three = anytimeTdHitFromValues([1, 1, 1, 0, 0], "Over");
  assert.ok(three.hit! < 0.5);
});

test("injury/opportunity bump cannot create extreme TD without RZ support", () => {
  const base = anytimeTdHitFromValues([0, 0, 0, 0, 1], "Over").hit!;
  const noRz = capAnytimeTdOpportunityBump(base, 1.35, { hasRedZoneSupport: false });
  const withRz = capAnytimeTdOpportunityBump(base, 1.35, { hasRedZoneSupport: true });
  assert.ok(noRz < base * 1.07, `noRz=${noRz} base=${base}`);
  assert.ok(withRz <= base * 1.13);
  assert.ok(noRz < 0.35, "backup cannot jump to 70% from vacancy alone");
  assert.ok(withRz < 0.4);
});

test("gradeFootballPropFromHistory uses Anytime TD model (NFL + NCAAF)", () => {
  const hist = {
    recent: [
      { stats: { rushingTouchdowns: "0", receivingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "0", receivingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "1", receivingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "0", receivingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "0", receivingTouchdowns: "0" } },
    ],
  };
  for (const sport of ["nfl", "ncaaf"] as const) {
    const pick = {
      player: "Backup RB",
      sport,
      isProp: true,
      propMarketKey: "player_anytime_td",
      market: "Anytime TD",
      propSide: "Over",
      propLine: 0.5,
      odds: 775,
    } as ParsedPick;
    const graded = gradeFootballPropFromHistory(pick, hist);
    assert.ok(graded.hitProbability != null, sport);
    assert.ok(graded.hitProbability! < 0.28, `${sport} hit=${graded.hitProbability}`);
    assert.ok((graded.hitReliability ?? 0) < 0.55, sport);
    // Calibrated toward +775 when thin.
    assert.ok(graded.hitProbability! < 0.25, `${sport} calibrated=${graded.hitProbability}`);
  }
});

test("boardLegPoolRole: +775 thin TD cannot seat on normal Coach", () => {
  const pick = {
    isProp: true,
    sport: "nfl",
    player: "Longshot WR",
    propMarketKey: "player_anytime_td",
    market: "Anytime TD",
    propSide: "Over",
    propLine: 0.5,
    odds: 775,
    game: "AWAY @ HOME",
    pick: "Longshot WR Anytime TD",
    finalAiScore: {
      grade: "C+",
      confidencePct: 52,
      edgePct: 18,
      simHit: 0.3,
      simAligned: true,
      recommends: true,
      composite: 6.2,
      highRiskValuePlay: false,
      factors: [],
      rubric: {
        composite: 6.2,
        grade: "C+",
        confidencePct: 52,
        edgePct: 18,
        scores: {} as never,
      },
    },
  } as ParsedPick;

  assert.equal(
    boardLegPoolRole(pick, pick.finalAiScore, {
      askText: "8 leg for tonight",
      ticketStyle: "balanced",
      hitReliability: 0.25,
    }),
    null,
  );

  // Strong reliability may pass the TD gate (qualify still applies).
  assert.equal(
    boardLegPoolRole(pick, pick.finalAiScore, {
      askText: "8 leg for tonight",
      hitReliability: 0.75,
    }),
    "main",
  );
});

test("F/D/C- TD never seats even with huge EV", () => {
  for (const grade of ["F", "D", "C-", "C"] as const) {
    const pick = {
      market: "Anytime TD",
      propMarketKey: "player_anytime_td",
      isProp: true,
      sport: "nfl",
      odds: 775,
      propsOnlyTicket: true,
      ticketRole: "main" as const,
    };
    const score = {
      grade,
      confidencePct: 60,
      edgePct: 20,
      simHit: 0.35,
      simAligned: true,
      recommends: true,
      composite: 4,
      highRiskValuePlay: false,
    } as any;
    assert.equal(propsOnlyTicketCleared(pick, score), false, grade);
  }
});

test("long odds cannot manufacture C+ seat through EV alone on TD", () => {
  const pick = {
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    isProp: true,
    sport: "ncaaf",
    odds: 30000,
    propsOnlyTicket: true,
  };
  const score = {
    grade: "F",
    confidencePct: 52,
    edgePct: 5,
    simHit: 0.08,
    simAligned: true,
    recommends: false,
    composite: 3,
    highRiskValuePlay: false,
  } as any;
  assert.equal(propsOnlyTicketCleared(pick, score), false);
});

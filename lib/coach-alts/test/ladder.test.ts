import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CoachQualifiedLeg } from "@workspace/coach-types";
import type { CoachRankedLeg } from "@workspace/coach-rank";

import {
  buildAltLadderIndex,
  buildAltLadders,
  collapseLadderChampions,
  compareRungSafety,
  findAltPromotion,
  ladderTierForSiblingIndex,
  marketLadderKey,
} from "../src/index";

function rankedLeg(
  overrides: Partial<CoachRankedLeg> & Pick<CoachRankedLeg, "pick" | "line" | "isAlt" | "kind">,
): CoachRankedLeg {
  return {
    legId: "l1",
    legFingerprint: `fp:${overrides.pick}`,
    sport: "mlb",
    gameId: "g1",
    gameLabel: "NYY @ BOS",
    marketKey: overrides.kind === "player_prop" ? "batter_hits" : "spreads",
    marketLabel: overrides.kind === "player_prop" ? "Hits" : "Run Line",
    odds: -110,
    startsAt: "2026-07-12T23:00:00.000Z",
    simHitPct: 56,
    evPct: 4,
    edgePct: 3.5,
    confidencePct: 58,
    compositeScore: 75,
    grade: "B+",
    gateEvaluation: {
      legFingerprint: "fp",
      sport: "mlb",
      results: [],
      allPassed: true,
      failedGateId: null,
    },
    rankScore: 80,
    rankPosition: 1,
    learningMultiplier: 1,
    confidenceAdjustmentPct: 0,
    effectiveConfidencePct: 58,
    ...overrides,
  };
}

describe("coach-alts tiers", () => {
  it("labels safest and high risk ends of a ladder", () => {
    assert.equal(ladderTierForSiblingIndex(0, 4), "Safest");
    assert.equal(ladderTierForSiblingIndex(3, 4), "High Risk");
  });

  it("sorts over props with lower line as safer", () => {
    const safer = rankedLeg({
      kind: "player_prop",
      pick: "Over 0.5",
      line: 0.5,
      isAlt: true,
      propSide: "Over",
    });
    const riskier = rankedLeg({
      kind: "player_prop",
      pick: "Over 2.5",
      line: 2.5,
      isAlt: true,
      propSide: "Over",
      legId: "l2",
      legFingerprint: "fp2",
    });
    assert.ok(compareRungSafety(safer, riskier) < 0);
  });
});

describe("coach-alts ladders", () => {
  const legs: CoachRankedLeg[] = [
    rankedLeg({
      kind: "player_prop",
      pick: "Over 1.5",
      line: 1.5,
      isAlt: false,
      propSide: "Over",
      playerName: "Aaron Judge",
      rankScore: 85,
    }),
    rankedLeg({
      kind: "player_prop",
      pick: "Over 2.5",
      line: 2.5,
      isAlt: true,
      propSide: "Over",
      playerName: "Aaron Judge",
      legId: "l2",
      legFingerprint: "fp2",
      rankScore: 78,
      edgePct: 5.2,
    }),
    rankedLeg({
      kind: "game_line",
      pick: "NYY -1.5",
      line: -1.5,
      isAlt: false,
      marketKey: "spreads",
      rankScore: 70,
    }),
    rankedLeg({
      kind: "game_line",
      pick: "NYY +1.5",
      line: 1.5,
      isAlt: true,
      marketKey: "spreads",
      legId: "l4",
      legFingerprint: "fp4",
      rankScore: 72,
    }),
  ];

  it("groups main and alt rungs under one ladder key", () => {
    const propMain = legs[0]!;
    const propAlt = legs[1]!;
    assert.equal(marketLadderKey(propMain), marketLadderKey(propAlt));
    const ladders = buildAltLadders(legs);
    assert.equal(ladders.length, 2);
    const propLadder = ladders.find((l) => l.kind === "player_prop");
    assert.equal(propLadder?.rungs.length, 2);
    assert.equal(propLadder?.mainRung?.pick, "Over 1.5");
  });

  it("prefers main rung as champion when both main and alt qualify", () => {
    const ladders = buildAltLadders(legs);
    const propLadder = ladders.find((l) => l.kind === "player_prop")!;
    assert.equal(propLadder.champion?.isMainRung, true);
    assert.equal(propLadder.champion?.pick, "Over 1.5");
  });

  it("exposes up to four display rungs with tier labels", () => {
    const manyAlts: CoachRankedLeg[] = [
      rankedLeg({ kind: "player_prop", pick: "Over 0.5", line: 0.5, isAlt: true, propSide: "Over", playerName: "Judge" }),
      rankedLeg({ kind: "player_prop", pick: "Over 1.5", line: 1.5, isAlt: false, propSide: "Over", playerName: "Judge", legId: "l2", legFingerprint: "fp2" }),
      rankedLeg({ kind: "player_prop", pick: "Over 2.5", line: 2.5, isAlt: true, propSide: "Over", playerName: "Judge", legId: "l3", legFingerprint: "fp3" }),
      rankedLeg({ kind: "player_prop", pick: "Over 3.5", line: 3.5, isAlt: true, propSide: "Over", playerName: "Judge", legId: "l4", legFingerprint: "fp4" }),
      rankedLeg({ kind: "player_prop", pick: "Over 4.5", line: 4.5, isAlt: true, propSide: "Over", playerName: "Judge", legId: "l5", legFingerprint: "fp5" }),
    ];
    const ladder = buildAltLadders(manyAlts)[0]!;
    assert.ok(ladder.displayRungs.length <= 4);
    assert.equal(ladder.displayRungs[0]?.tierLabel, "Safest");
  });

  it("collapses to one champion per ladder for ticket assembly", () => {
    const index = buildAltLadderIndex(legs);
    assert.equal(index.champions.length, 2);
    assert.equal(collapseLadderChampions(index.ladders).length, 2);
  });

  it("can promote an alt when main is absent from qualified set", () => {
    const altOnly = legs.filter((l) => l.playerName === "Aaron Judge" && l.isAlt);
    const ladder = buildAltLadders(altOnly)[0]!;
    assert.equal(ladder.mainRung, null);
    assert.equal(findAltPromotion(ladder)?.pick, "Over 2.5");
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comparePickStrength,
  filterMainTicketPicks,
  gameLineHasSharpAgreement,
  gameLineMeetsSimBar,
  pickHasCoachCardMetrics,
  pickRubricForDisplay,
  isFullyQualifiedPick,
  isGameLineMainTicketQualified,
  isLongshotSectionPick,
  isLongshotMainTicketQualified,
  isMainTicketQualified,
  isPropMainTicketQualified,
  assertMainTicketPicksQualified,
  MainTicketQualificationError,
  MIN_MAIN_PICK_CONFIDENCE,
  MIN_MAIN_PICK_GRADE,
  GAME_LINE_EXCEPTIONAL_EV_PCT,
  GAME_LINE_SIM_MIN_HIT,
  partitionQualifiedPicks,
  reasonPickNotQualified,
  resolvePickEdgePct,
} from "./parlayQualifiedGate.ts";
import { expectedValuePct } from "./altLineEvSelect.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function qualifiedPick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "A @ B",
    market: "Spread",
    pick: "A +1.5",
    odds: -110,
    isProp: false,
    sport: "mlb",
    gameLineFinal: { reason: "test", finalScore: 6.5 },
    finalAiScore: {
      grade: "B+",
      simHit: 0.55,
      edgePct: 2.1,
      confidencePct: 62,
      composite: 7.5,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: 7.5,
        grade: "B+",
        confidencePct: 62,
        edgePct: 2.1,
      },
    },
    scores: {
      scores: {},
      composite: 7.5,
      grade: "B+",
      confidencePct: 62,
      edgePct: 2.1,
    },
    ...overrides,
  };
}

test("main ticket rejects grade below C+", () => {
  const score = qualifiedPick().finalAiScore!;
  assert.equal(isPropMainTicketQualified({ ...score, grade: "C" }, -110), false);
  assert.equal(isPropMainTicketQualified({ ...score, grade: "C+" }, -110), true);
});

test("main ticket rejects confidence below 52", () => {
  const score = qualifiedPick().finalAiScore!;
  assert.equal(
    isMainTicketQualified({ ...score, confidencePct: MIN_MAIN_PICK_CONFIDENCE - 1 }, -110),
    false,
  );
  assert.equal(
    isMainTicketQualified({ ...score, confidencePct: MIN_MAIN_PICK_CONFIDENCE }, -110),
    true,
  );
});

test("main ticket rejects negative edge", () => {
  assert.equal(
    isFullyQualifiedPick(
      qualifiedPick({
        finalAiScore: { ...qualifiedPick().finalAiScore!, edgePct: -1.2 },
      }),
    ),
    false,
  );
  const reason = reasonPickNotQualified(
    qualifiedPick({ finalAiScore: { ...qualifiedPick().finalAiScore!, edgePct: -0.5 } }),
  );
  assert.match(reason, /non-positive EV/i);
});

test("main ticket rejects zero edge", () => {
  const score = qualifiedPick().finalAiScore!;
  assert.equal(isMainTicketQualified({ ...score, edgePct: 0 }, -110, 0), false);
});

test("resolvePickEdgePct uses conservative min across score sources", () => {
  const pick = qualifiedPick({
    finalAiScore: { ...qualifiedPick().finalAiScore!, edgePct: 2.5 },
    scores: { ...qualifiedPick().finalAiScore!.rubric, edgePct: -0.9 },
  });
  assert.equal(resolvePickEdgePct(pick), -0.9);
  assert.equal(isFullyQualifiedPick(pick), false);
});

test("filterMainTicketPicks drops non-positive-edge legs", () => {
  const good = qualifiedPick();
  const bad = qualifiedPick({
    game: "C @ D",
    pick: "C +1.5",
    finalAiScore: { ...qualifiedPick().finalAiScore!, edgePct: -0.9 },
    scores: { ...qualifiedPick().finalAiScore!.rubric, edgePct: -0.9 },
  });
  const filtered = filterMainTicketPicks([good, bad]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].game, good.game);
});

test("prop main ticket rejects sim below 52% even with high-risk bypass", () => {
  assert.equal(
    isFullyQualifiedPick(
      qualifiedPick({
        isProp: true,
        market: "Strikeouts",
        pick: "Player Over 3.5 Strikeouts",
        finalAiScore: {
          ...qualifiedPick().finalAiScore!,
          simHit: 0.48,
          simAligned: false,
          highRiskValuePlay: true,
          edgePct: 5.2,
        },
      }),
    ),
    false,
  );
});

test("prop main ticket rejects sim disagreement", () => {
  const reason = reasonPickNotQualified(
    qualifiedPick({
      isProp: true,
      market: "Strikeouts",
      pick: "Player Over 3.5 Strikeouts",
      finalAiScore: {
        ...qualifiedPick().finalAiScore!,
        simAligned: false,
        highRiskValuePlay: false,
      },
    }),
  );
  assert.match(reason, /disagrees/i);
});

test("main ticket rejects grade D and confidence under 50", () => {
  const score = qualifiedPick().finalAiScore!;
  assert.equal(isMainTicketQualified({ ...score, grade: "D" }, -110), false);
  assert.equal(
    isFullyQualifiedPick(
      qualifiedPick({
        finalAiScore: { ...score, grade: "D", edgePct: -2.4, confidencePct: 48 },
      }),
    ),
    false,
  );
});

test("game line rejects 49% sim without exceptional edge", () => {
  const score = {
    composite: 7,
    grade: "C+",
    confidencePct: 55,
    edgePct: 1.2,
    simHit: 0.49,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: 1.2 },
  };
  assert.equal(isGameLineMainTicketQualified(score, -110), false);
  assert.equal(gameLineMeetsSimBar(0.49, 1.2), false);
  assert.equal(
    isFullyQualifiedPick({
      game: "A @ B",
      market: "Spread",
      pick: "B +1.5",
      odds: -110,
      isProp: false,
      finalAiScore: score,
    }),
    false,
  );
});

test("game line accepts 50% sim only with strong +EV or best EV", () => {
  const score = {
    composite: 7,
    grade: "C+",
    confidencePct: 55,
    edgePct: 1.2,
    simHit: 0.5,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: 1.2 },
  };
  const weakEv = expectedValuePct(0.5, 105, null, 1.2);
  assert.ok(weakEv != null && weakEv > 0 && weakEv < 3);
  assert.equal(isGameLineMainTicketQualified(score, 105, 1.2, weakEv), false);
  assert.equal(gameLineMeetsSimBar(0.5, 1.2, { evPct: weakEv }), false);

  const strongEv = expectedValuePct(0.5, 250, null, 4);
  assert.ok(strongEv != null && strongEv >= 3);
  assert.equal(isGameLineMainTicketQualified(score, 250, 4, strongEv), true);
  assert.equal(gameLineMeetsSimBar(0.5, 4, { evPct: strongEv }), true);
  assert.equal(gameLineMeetsSimBar(0.5, 1.2, { evPct: weakEv, isBestEvLine: true }), true);
});

test("game line rejects 49% sim even with exceptional edge", () => {
  const score = {
    composite: 7,
    grade: "C+",
    confidencePct: 55,
    edgePct: GAME_LINE_EXCEPTIONAL_EV_PCT,
    simHit: 0.49,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: {
      scores: {},
      composite: 7,
      grade: "C+",
      confidencePct: 62,
      edgePct: GAME_LINE_EXCEPTIONAL_EV_PCT,
    },
  };
  const ev = expectedValuePct(0.49, 250, null, GAME_LINE_EXCEPTIONAL_EV_PCT);
  assert.ok(ev != null && ev > 0);
  assert.equal(isGameLineMainTicketQualified(score, 250, GAME_LINE_EXCEPTIONAL_EV_PCT, ev), false);
  assert.equal(gameLineMeetsSimBar(0.49, GAME_LINE_EXCEPTIONAL_EV_PCT, { evPct: ev }), false);
});

test("longshot main ticket accepts 50% sim prop with positive edge", () => {
  const score = {
    composite: 7,
    grade: "C+",
    confidencePct: 55,
    edgePct: 1.2,
    simHit: 0.5,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: 1.2 },
  };
  assert.equal(isLongshotMainTicketQualified(score, 110), true);
  assert.equal(isMainTicketQualified(score, 110), false);
});

test("longshot main ticket rejects sim below 49%", () => {
  const score = {
    composite: 7,
    grade: "C+",
    confidencePct: 55,
    edgePct: 1.2,
    simHit: 0.48,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: 1.2 },
  };
  assert.equal(isLongshotMainTicketQualified(score, 110), false);
});

test("filterMainTicketPicks rejects game line without scores or positive EV", () => {
  const gamePick = {
    game: "Toronto Blue Jays @ Seattle Mariners",
    market: "Spread",
    pick: "Mariners +1.5",
    odds: 110,
    isProp: false,
    gameLineFinal: { reason: "test", finalScore: 6.2 },
    finalAiScore: {
      composite: 7,
      grade: "C+",
      confidencePct: 62,
      edgePct: 1.2,
      simHit: 0.5,
      simAligned: false,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 62, edgePct: 1.2 },
    },
  };
  assert.equal(filterMainTicketPicks([gamePick]).length, 0);
});

test("filterMainTicketPicks keeps 50% sim game line with full display when best EV", () => {
  const gamePick = qualifiedPick({
    game: "Toronto Blue Jays @ Seattle Mariners",
    market: "Spread",
    pick: "Mariners +1.5",
    odds: 105,
    finalAiScore: {
      ...qualifiedPick().finalAiScore!,
      simHit: 0.5,
      simAligned: false,
      edgePct: 1.2,
    },
    scores: { ...qualifiedPick().scores!, edgePct: 1.2 },
    gameLineFinal: { reason: "Highest EV", finalScore: 6.2, isBestEv: true },
  });
  assert.equal(filterMainTicketPicks([gamePick]).length, 1);
});

test("filterMainTicketPicks rejects 49% game line", () => {
  const gamePick = {
    game: "Toronto Blue Jays @ Seattle Mariners",
    market: "Spread",
    pick: "Mariners +1.5",
    odds: -110,
    isProp: false,
    finalAiScore: {
      composite: 7,
      grade: "C+",
      confidencePct: 62,
      edgePct: 1.2,
      simHit: 0.49,
      simAligned: false,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: 1.2 },
    },
  };
  assert.equal(filterMainTicketPicks([gamePick]).length, 0);
});

test("filterMainTicketPicks keeps 50% sim prop on longshot ask only", () => {
  const propPick = {
    game: "A @ B",
    market: "Strikeouts",
    pick: "Player Over 3.5 Strikeouts",
    odds: 110,
    isProp: true,
    scores: { scores: {}, composite: 7, grade: "C+", confidencePct: 62, edgePct: 1.2 },
    finalAiScore: {
      composite: 7,
      grade: "C+",
      confidencePct: 62,
      edgePct: 1.2,
      simHit: 0.5,
      simAligned: false,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: 1.2 },
    },
  };
  assert.equal(filterMainTicketPicks([propPick], { longshotAsk: true }).length, 1);
  assert.equal(filterMainTicketPicks([propPick]).length, 0);
});

test("longshot section accepts negative edge when not main-qualified", () => {
  const p = qualifiedPick({
    finalAiScore: {
      ...qualifiedPick().finalAiScore!,
      edgePct: -2,
      simAligned: false,
      simHit: 0.45,
    },
  });
  assert.equal(isFullyQualifiedPick(p), false);
  assert.equal(isLongshotSectionPick(p), true);
});

test("comparePickStrength ranks higher Final Score first for game lines", () => {
  const low = qualifiedPick({
    finalAiScore: { ...qualifiedPick().finalAiScore!, edgePct: 1.0, simHit: 0.52, grade: "C+" },
    odds: -110,
  });
  const high = qualifiedPick({
    game: "C @ D",
    pick: "C +1.5",
    finalAiScore: {
      ...qualifiedPick().finalAiScore!,
      edgePct: 2.5,
      simHit: 0.58,
      grade: "A-",
      confidencePct: 72,
    },
    odds: 120,
  });
  assert.ok(comparePickStrength(high, low) < 0);
});

test("partitionQualifiedPicks splits ticket", () => {
  const good = qualifiedPick();
  const bad = qualifiedPick({ odds: null });
  const { qualified, unqualified } = partitionQualifiedPicks([good, bad]);
  assert.equal(qualified.length, 1);
  assert.equal(unqualified.length, 1);
});

test("pickHasCoachCardMetrics rejects pick with finalAi but no rubric composite", () => {
  const pick = qualifiedPick({
    scores: undefined,
    finalAiScore: {
      ...qualifiedPick().finalAiScore!,
      rubric: { scores: {}, composite: null, grade: null, confidencePct: null, edgePct: 2.1 },
    },
  });
  assert.equal(pickHasCoachCardMetrics(pick), false);
  assert.equal(isFullyQualifiedPick(pick), false);
});

test("pickHasCoachCardMetrics accepts fully scored game line", () => {
  const pick = qualifiedPick();
  assert.equal(pickHasCoachCardMetrics(pick), true);
});

test("assertMainTicketPicksQualified throws for C- grade prop", () => {
  const weak = qualifiedPick({
    isProp: true,
    player: "Michael Harris II",
    market: "Player Prop",
    pick: "Over 1.5 Total Bases",
    finalAiScore: {
      ...qualifiedPick().finalAiScore!,
      grade: "C-",
      confidencePct: 49,
      simHit: 0.49,
      simAligned: false,
    },
  });
  assert.throws(
    () => assertMainTicketPicksQualified([weak]),
    MainTicketQualificationError,
  );
});

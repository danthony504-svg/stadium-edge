import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comparePickStrength,
  filterMainTicketPicks,
  isFullyQualifiedPick,
  isLongshotSectionPick,
  isLongshotMainTicketQualified,
  isMainTicketQualified,
  MIN_MAIN_PICK_CONFIDENCE,
  MIN_MAIN_PICK_GRADE,
  partitionQualifiedPicks,
  reasonPickNotQualified,
  resolvePickEdgePct,
} from "./parlayQualifiedGate.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function qualifiedPick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "A @ B",
    market: "Spread",
    pick: "A +1.5",
    odds: -110,
    isProp: false,
    sport: "mlb",
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
    ...overrides,
  };
}

test("main ticket rejects grade below C+", () => {
  const score = qualifiedPick().finalAiScore!;
  assert.equal(isMainTicketQualified({ ...score, grade: "C" }, -110), false);
  assert.equal(isMainTicketQualified({ ...score, grade: "C+" }, -110), true);
});

test("main ticket rejects confidence below 50", () => {
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

test("main ticket rejects sim below 52% and high-risk bypass", () => {
  assert.equal(
    isFullyQualifiedPick(
      qualifiedPick({
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

test("main ticket rejects sim disagreement", () => {
  const reason = reasonPickNotQualified(
    qualifiedPick({
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

test("longshot main ticket accepts 50% sim with positive edge", () => {
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

test("filterMainTicketPicks keeps 50% sim leg on longshot ask", () => {
  const pick = {
    game: "A @ B",
    market: "Spread",
    pick: "B +1.5",
    odds: 110,
    isProp: false,
    finalAiScore: {
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
    },
  };
  const filtered = filterMainTicketPicks([pick], { longshotAsk: true });
  assert.equal(filtered.length, 1);
  const strict = filterMainTicketPicks([pick]);
  assert.equal(strict.length, 0);
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

test("comparePickStrength ranks higher edge first", () => {
  const low = qualifiedPick({
    finalAiScore: { ...qualifiedPick().finalAiScore!, edgePct: 1.0 },
  });
  const high = qualifiedPick({
    game: "C @ D",
    pick: "C +1.5",
    finalAiScore: { ...qualifiedPick().finalAiScore!, edgePct: 4.5, simHit: 0.54 },
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

test("MIN_MAIN_PICK_GRADE is C+", () => {
  assert.equal(MIN_MAIN_PICK_GRADE, "C+");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFullyQualifiedGameLineFinalAi,
  isFullyQualifiedPick,
  partitionQualifiedPicks,
  reasonPickNotQualified,
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

test("game lines reject sim below 52% even with positive edge", () => {
  const score = qualifiedPick().finalAiScore!;
  assert.equal(
    isFullyQualifiedGameLineFinalAi({ ...score, simHit: 0.5, simAligned: false }, -110),
    false,
  );
});

test("game lines reject high-risk value play bypass", () => {
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

test("game lines require sim alignment", () => {
  const reason = reasonPickNotQualified(
    qualifiedPick({
      finalAiScore: {
        ...qualifiedPick().finalAiScore!,
        simAligned: false,
        highRiskValuePlay: false,
      },
    }),
  );
  assert.match(reason, /simulator.*disagrees/i);
});

test("props still allow high-risk value play with complete fields", () => {
  assert.equal(
    isFullyQualifiedPick({
      ...qualifiedPick({
        isProp: true,
        market: "Hits",
        player: "Star",
        finalAiScore: {
          ...qualifiedPick().finalAiScore!,
          simHit: 0.48,
          simAligned: false,
          highRiskValuePlay: true,
          edgePct: 5.2,
        },
      }),
    }),
    true,
  );
});

test("partitionQualifiedPicks splits ticket", () => {
  const good = qualifiedPick();
  const bad = qualifiedPick({ odds: null });
  const { qualified, unqualified } = partitionQualifiedPicks([good, bad]);
  assert.equal(qualified.length, 1);
  assert.equal(unqualified.length, 1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

test("isFullyQualifiedPick requires grade, sim, edge, confidence, composite, and odds", () => {
  assert.equal(isFullyQualifiedPick(qualifiedPick()), true);
  assert.equal(isFullyQualifiedPick(qualifiedPick({ finalAiScore: undefined })), false);
  assert.equal(
    isFullyQualifiedPick(
      qualifiedPick({
        finalAiScore: {
          ...qualifiedPick().finalAiScore!,
          simHit: null,
        },
      }),
    ),
    false,
  );
  assert.equal(
    isFullyQualifiedPick(
      qualifiedPick({
        finalAiScore: {
          ...qualifiedPick().finalAiScore!,
          edgePct: null,
        },
      }),
    ),
    false,
  );
  assert.equal(isFullyQualifiedPick(qualifiedPick({ odds: null })), false);
});

test("isFullyQualifiedPick rejects non-positive edge", () => {
  assert.equal(
    isFullyQualifiedPick(
      qualifiedPick({
        finalAiScore: {
          ...qualifiedPick().finalAiScore!,
          edgePct: -0.5,
        },
      }),
    ),
    false,
  );
});

test("isFullyQualifiedPick allows high-risk value play with complete fields", () => {
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
    true,
  );
});

test("reasonPickNotQualified names the first missing field", () => {
  const p = qualifiedPick({ finalAiScore: undefined });
  assert.match(reasonPickNotQualified(p), /Final AI Score/i);
  assert.match(
    reasonPickNotQualified(qualifiedPick({ finalAiScore: { ...qualifiedPick().finalAiScore!, simHit: null } })),
    /Simulation Hit/i,
  );
});

test("partitionQualifiedPicks splits ticket", () => {
  const good = qualifiedPick();
  const bad = qualifiedPick({ odds: null });
  const { qualified, unqualified } = partitionQualifiedPicks([good, bad]);
  assert.equal(qualified.length, 1);
  assert.equal(unqualified.length, 1);
});

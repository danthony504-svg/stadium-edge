import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COACH_LEARNING_MIN_SAMPLE_SIZE } from "@workspace/coach-types";

import {
  applyLearningNudge,
  emptyLearningState,
  lookupLearningAdjustment,
  mergeLearningAdjustments,
} from "../src/index";

describe("coach-learn", () => {
  it("ignores adjustments below minimum sample size", () => {
    const state = {
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      adjustments: [
        {
          sport: "mlb",
          marketKey: "batter_hits",
          rankWeightMultiplier: 1.2,
          confidenceAdjustmentPct: 5,
          sampleSize: COACH_LEARNING_MIN_SAMPLE_SIZE - 1,
        },
      ],
    };
    const adj = lookupLearningAdjustment(state, "mlb", "batter_hits");
    assert.equal(adj.active, false);
    assert.equal(adj.rankWeightMultiplier, 1);
  });

  it("applies active learning nudges to confidence only", () => {
    const state = {
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      adjustments: [
        {
          sport: "mlb",
          marketKey: "batter_hits",
          rankWeightMultiplier: 1.15,
          confidenceAdjustmentPct: 4,
          sampleSize: COACH_LEARNING_MIN_SAMPLE_SIZE,
        },
      ],
    };
    const nudge = applyLearningNudge(
      { sport: "mlb", marketKey: "batter_hits", confidencePct: 58 },
      state,
    );
    assert.equal(nudge.rankWeightMultiplier, 1.15);
    assert.equal(nudge.effectiveConfidencePct, 62);
  });

  it("merges learning adjustments by sport+market key", () => {
    const merged = mergeLearningAdjustments(emptyLearningState(), [
      {
        sport: "mlb",
        marketKey: "batter_hits",
        rankWeightMultiplier: 1.1,
        confidenceAdjustmentPct: 2,
        sampleSize: 25,
      },
    ]);
    assert.equal(merged.adjustments.length, 1);
    assert.equal(merged.version, 2);
  });
});

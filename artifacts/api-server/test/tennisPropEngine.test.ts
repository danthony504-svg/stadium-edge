import assert from "node:assert/strict";
import test from "node:test";

import { gradeTennisProp } from "../src/lib/tennisPropGrade.js";
import { tennisPropLearningWeight } from "../src/lib/tennisPropLearning.js";
import type { TennisPropLine } from "../src/lib/tennisPropTypes.js";

const baseLine = (overrides: Partial<TennisPropLine> = {}): TennisPropLine => ({
  eventId: "ev1",
  matchLabel: "A @ B",
  awayPlayer: "A",
  homePlayer: "B",
  player: "A",
  market: "player_aces",
  marketLabel: "aces",
  line: 8.5,
  side: "Over",
  odds: 110,
  book: "test",
  alt: false,
  ...overrides,
});

test("gradeTennisProp recommends strong edge + sim alignment", () => {
  const grade = gradeTennisProp({
    line: baseLine({ odds: 120 }),
    sim: {
      simulations: 10_000,
      hitProbability: 0.58,
      meanProjection: 9.2,
      confidenceScore: 72,
    },
    fairProb: 0.58,
  });
  assert.equal(grade.recommends, true);
  assert.ok((grade.edgePct ?? 0) > 0);
  assert.ok(grade.grade === "B+" || (grade.grade && grade.grade.startsWith("A")));
});

test("gradeTennisProp skips negative edge", () => {
  const grade = gradeTennisProp({
    line: baseLine({ odds: -200 }),
    sim: {
      simulations: 10_000,
      hitProbability: 0.45,
      meanProjection: 7,
      confidenceScore: 60,
    },
    fairProb: 0.45,
  });
  assert.equal(grade.recommends, false);
  assert.ok(grade.skipReason?.includes("edge"));
});

test("tennisPropLearningWeight nudges hot markets up", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    sport: "tennis",
    market: "player_aces",
    outcome: (i < 17 ? "win" : "loss") as "win" | "loss",
  }));
  const w = tennisPropLearningWeight("player_aces", history);
  assert.ok(w > 1);
});

test("tennisPropLearningWeight stays neutral with small sample", () => {
  const w = tennisPropLearningWeight("player_aces", [
    { sport: "tennis", market: "player_aces", outcome: "win" },
  ]);
  assert.equal(w, 1);
});

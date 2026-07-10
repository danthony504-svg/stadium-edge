import assert from "node:assert/strict";
import test from "node:test";

import { gradeProp, PROP_ENGINE_MIN_GRADE } from "../src/lib/propEngine/grade.js";
import { propLearningWeight } from "../src/lib/propEngine/learning.js";
import type { PropLine } from "../src/lib/propEngine/types.js";

const baseLine = (overrides: Partial<PropLine> = {}): PropLine => ({
  sport: "tennis",
  eventId: "ev1",
  matchLabel: "A @ B",
  awayName: "A",
  homeName: "B",
  subject: "Player A",
  market: "player_aces",
  marketLabel: "aces",
  line: 8.5,
  side: "Over",
  odds: 110,
  book: "test",
  alt: false,
  ...overrides,
});

test("gradeProp recommends strong edge + sim alignment", () => {
  const grade = gradeProp({
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
  assert.equal(PROP_ENGINE_MIN_GRADE, "B+");
});

test("gradeProp skips negative edge", () => {
  const grade = gradeProp({
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
});

test("propLearningWeight nudges hot markets up", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    sport: "ufc",
    market: "fighter_sig_strikes",
    outcome: (i < 17 ? "win" : "loss") as "win" | "loss",
  }));
  assert.ok(propLearningWeight("ufc", "fighter_sig_strikes", history) > 1);
});

test("PROP_ENGINE_MIN_GRADE is B+", () => {
  assert.equal(PROP_ENGINE_MIN_GRADE, "B+");
});

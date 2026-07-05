import assert from "node:assert/strict";
import test from "node:test";
import { reachSelectQualifiedToTarget } from "./parlaySelectReach.ts";
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

test("reachSelectQualifiedToTarget relaxes per-game caps to fill target", () => {
  const candidates: ParsedPick[] = [];
  for (let i = 0; i < 15; i++) {
    const game = `Team${i} A @ Team${i} B`;
    candidates.push(
      qualifiedPick({
        game,
        pick: `Team${i} A +1.5`,
        isProp: i % 3 === 0,
        market: i % 3 === 0 ? "Hits" : "Spread",
      }),
    );
  }
  const out = reachSelectQualifiedToTarget(candidates, 15, { maxPerGame: 1, maxGameLegs: 5 });
  assert.equal(out.length, 15);
});

test("reachSelectQualifiedToTarget never adds unqualified legs", () => {
  const good = qualifiedPick();
  const bad = qualifiedPick({
    game: "C @ D",
    finalAiScore: {
      ...qualifiedPick().finalAiScore!,
      edgePct: -1,
      simAligned: false,
    },
  });
  const out = reachSelectQualifiedToTarget([good, bad], 2);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.game, good.game);
});

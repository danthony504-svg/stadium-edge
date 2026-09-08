import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "./parsedPick.ts";
import {
  dropPropsOpposingTrackedPicks,
  enforceConsistentPropSides,
  propIdentityKey,
} from "./propSideConsistency.ts";
import type { TrackedPick } from "./pickTracker.ts";

const GAME = "Chicago Cubs @ Baltimore Orioles";

function rea(side: "Over" | "Under", odds = 124): ParsedPick {
  return {
    game: GAME,
    market: "Strikeouts",
    pick: `Colin Rea ${side} 3.5 Strikeouts`,
    odds,
    isProp: true,
    sport: "mlb",
    player: "Colin Rea",
    propLine: 3.5,
    propSide: side,
  };
}

test("propIdentityKey matches nickname and full game labels", () => {
  const a = propIdentityKey(rea("Over"));
  const b = propIdentityKey({
    ...rea("Over"),
    game: "Cubs @ Orioles",
    pick: "Colin Rea Over 3.5 Strikeouts",
  });
  assert.equal(a, b);
});

test("enforceConsistentPropSides drops opposing sides on same prop", () => {
  const r = enforceConsistentPropSides([rea("Over"), rea("Under", 110)]);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
  assert.match(r.picks[0]!.pick, /Over/i);
});

test("enforceConsistentPropSides keeps higher-scored conflicting leg", () => {
  const over = { ...rea("Over"), finalAiScore: { composite: 40 } as ParsedPick["finalAiScore"] };
  const under = { ...rea("Under"), finalAiScore: { composite: 70 } as ParsedPick["finalAiScore"] };
  const r = enforceConsistentPropSides([over, under]);
  assert.equal(r.picks.length, 1);
  assert.match(r.picks[0]!.pick, /Under/i);
});

test("dropPropsOpposingTrackedPicks blocks flip after recent Coach Over", () => {
  const tracked: TrackedPick[] = [
    {
      id: "1",
      capturedAt: Date.now() - 60_000,
      date: "2026-07-08",
      sport: "mlb",
      game: GAME,
      player: "Colin Rea",
      market: "Strikeouts",
      line: 3.5,
      pick: "Colin Rea Over 3.5 Strikeouts",
      odds: 124,
      aiGrade: "B",
      confidence: 58,
      edge: 2,
      ev: null,
      simHitPct: null,
      isProp: true,
      status: "pending",
      source: "coach",
      side: "Over",
    },
  ];
  const r = dropPropsOpposingTrackedPicks([rea("Under")], tracked);
  assert.equal(r.picks.length, 0);
  assert.equal(r.dropped, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.ts";
import {
  assistantPicksEqual,
  buildDeliveryLegNote,
  mergeResolvedWithExistingPicks,
  pickHasRenderableDeliveryData,
  rankScanCandidatesForDelivery,
} from "./coachDeliveryResolve.ts";
import { nextCoachPhase } from "./coachStateMachine.ts";
import {
  isCoachRequestCompleted,
  markCoachRequestCompleted,
  resetCoachRequestCompletionForTests,
  shouldSkipPostCompletionCoachWork,
} from "./coachRequestCompletion.ts";

const enrich = { realOdds: [], propPool: [], gameMeta: [] };

function gradedLeg(id: string, composite: number, pick = `Over ${id}`): ParsedPick {
  return {
    game: `Game ${id}`,
    market: "Points",
    pick,
    odds: -110,
    isProp: true,
    player: `Player ${id}`,
    ticketRole: "main",
    finalAiScore: {
      composite,
      edgePct: 5,
      simHit: 0.55,
      simAligned: true,
      grade: "B+",
      recommends: true,
      confidencePct: 70,
    },
    scores: { composite },
  };
}

test("pickHasRenderableDeliveryData requires odds and graded score", () => {
  assert.equal(pickHasRenderableDeliveryData(gradedLeg("a", 90)), true);
  assert.equal(pickHasRenderableDeliveryData({ ...gradedLeg("b", 90), odds: undefined }), false);
});

test("mergeResolvedWithExistingPicks preserves visible cards when gate returns empty", () => {
  const existing = [gradedLeg("e1", 95), gradedLeg("e2", 90)];
  const merged = mergeResolvedWithExistingPicks(existing, [], 15);
  assert.equal(merged.length, 2);
  assert.equal(assistantPicksEqual(merged, existing), true);
});

test("mergeResolvedWithExistingPicks prefers larger valid resolved set", () => {
  const existing = [gradedLeg("e1", 80)];
  const resolved = [gradedLeg("r1", 95), gradedLeg("r2", 90), gradedLeg("r3", 85)];
  const merged = mergeResolvedWithExistingPicks(existing, resolved, 15);
  assert.equal(merged.length, 3);
});

test("rankScanCandidatesForDelivery returns unique legs up to target", () => {
  const candidates = Array.from({ length: 20 }, (_, i) => gradedLeg(`p${i}`, 100 - i));
  const ranked = rankScanCandidatesForDelivery(candidates, enrich, 15);
  assert.equal(ranked.length, 15);
  const fps = new Set(ranked.map((p) => `${p.player}:${p.market}:${p.pick}`));
  assert.equal(fps.size, 15);
});

test("rankScanCandidatesForDelivery removes opposite O/U on same prop", () => {
  const over = gradedLeg("x", 95, "Over 24.5");
  const under = gradedLeg("x", 94, "Under 24.5");
  const ranked = rankScanCandidatesForDelivery([over, under], enrich, 5);
  assert.equal(ranked.length, 1);
});

test("buildDeliveryLegNote states available count when fewer than target", () => {
  const note = buildDeliveryLegNote("", 15, 8);
  assert.match(note, /8/);
  assert.match(note, /15/);
});

test("request completion guard blocks repeated post-completion work", () => {
  resetCoachRequestCompletionForTests();
  assert.equal(shouldSkipPostCompletionCoachWork("req-a"), false);
  markCoachRequestCompleted("req-a");
  assert.equal(isCoachRequestCompleted("req-a"), true);
  assert.equal(shouldSkipPostCompletionCoachWork("req-a"), true);
  assert.equal(shouldSkipPostCompletionCoachWork("req-b"), false);
});

test("nextCoachPhase is idempotent — repeated completion does not advance phase loop", () => {
  let phase = nextCoachPhase("finalizing", "completed", false);
  assert.equal(phase, "completed");
  const again = nextCoachPhase(phase, "completed", false);
  assert.equal(again, "completed");
  const third = nextCoachPhase(again, "completed", false);
  assert.equal(third, "completed");
});

test("15-leg request uses all available valid picks when fewer than 15 qualify", () => {
  const candidates = Array.from({ length: 9 }, (_, i) => gradedLeg(`q${i}`, 99 - i));
  const ranked = rankScanCandidatesForDelivery(candidates, enrich, 15);
  assert.equal(ranked.length, 9);
  const note = buildDeliveryLegNote("scan done", 15, ranked.length);
  assert.match(note, /9/);
});

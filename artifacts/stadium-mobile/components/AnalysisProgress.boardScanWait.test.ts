import assert from "node:assert/strict";
import test from "node:test";

/**
 * Mirrors AnalysisProgress active-checklist selection for build mode.
 * During board-scan wait (93% cap, no legs yet) "Final ticket ready" must
 * remain the active spinning step — never a dead empty circle.
 */
function activeChecklistIndex(opts: {
  effectiveIndex: number;
  checklist: { label: string; doneAt: number }[];
}): number {
  return opts.checklist.findIndex((c) => opts.effectiveIndex < c.doneAt);
}

const CHECKLIST = [
  { label: "Matchups analyzed", doneAt: 3 },
  { label: "Injury report checked", doneAt: 4 },
  { label: "Line value calculated", doneAt: 6 },
  { label: "Correlation scored", doneAt: 7 },
  { label: "Final ticket ready", doneAt: 9 },
] as const;

test("board-scan wait at 93% keeps Final ticket ready as the spinning step", () => {
  // maxAuto 8 → TARGETS[8] === 93 while legCount === 0
  const idx = activeChecklistIndex({ effectiveIndex: 8, checklist: [...CHECKLIST] });
  assert.equal(idx, 4);
  assert.equal(CHECKLIST[idx].label, "Final ticket ready");
});

test("earlier stages still activate before Final ticket", () => {
  const idx = activeChecklistIndex({ effectiveIndex: 5, checklist: [...CHECKLIST] });
  assert.equal(CHECKLIST[idx].label, "Line value calculated");
});

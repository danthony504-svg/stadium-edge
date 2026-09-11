import assert from "node:assert/strict";
import test from "node:test";

/**
 * Mirrors AnalysisProgress active-checklist selection for build mode.
 * During board-scan wait (93% cap, no legs yet) "Final ticket ready" must
 * remain the active spinning step — never a dead empty circle.
 */
function checklistDoneFlags(opts: {
  effectiveIndex: number;
  legCount: number;
  scoredLegCount: number;
  requestedLegs: number;
  checklist: { label: string; doneAt: number }[];
}): boolean[] {
  const scoredRatio =
    opts.requestedLegs > 0 && opts.scoredLegCount > 0
      ? opts.scoredLegCount / opts.requestedLegs
      : 0;
  return opts.checklist.map((item) => {
    const scoredDone =
      item.label === "Final ticket ready"
        ? false
        : item.label === "Correlation scored"
          ? scoredRatio >= 0.75
          : item.label === "Line value calculated"
            ? scoredRatio >= 0.5
            : item.label === "Injury report checked"
              ? scoredRatio >= 0.35
              : item.label === "Matchups analyzed"
                ? scoredRatio >= 0.2
                : false;
    if (item.label === "Final ticket ready") return opts.legCount > 0;
    return opts.effectiveIndex >= item.doneAt || scoredDone;
  });
}

function activeChecklistIndex(opts: {
  effectiveIndex: number;
  legCount?: number;
  scoredLegCount?: number;
  requestedLegs?: number;
  checklist: { label: string; doneAt: number }[];
}): number {
  const flags = checklistDoneFlags({
    effectiveIndex: opts.effectiveIndex,
    legCount: opts.legCount ?? 0,
    scoredLegCount: opts.scoredLegCount ?? 0,
    requestedLegs: opts.requestedLegs ?? 0,
    checklist: opts.checklist,
  });
  let idx = flags.findIndex((done) => !done);
  if (
    idx < 0 &&
    (opts.legCount ?? 0) === 0 &&
    (opts.requestedLegs ?? 0) > 0 &&
    (opts.scoredLegCount ?? 0) >= (opts.requestedLegs ?? 0)
  ) {
    idx = opts.checklist.findIndex((c) => c.label === "Final ticket ready");
  }
  return idx;
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

test("scored 6 of 6 with mid effectiveIndex still spins Final ticket ready", () => {
  const idx = activeChecklistIndex({
    effectiveIndex: 5,
    legCount: 0,
    scoredLegCount: 6,
    requestedLegs: 6,
    checklist: [...CHECKLIST],
  });
  assert.equal(CHECKLIST[idx].label, "Final ticket ready");
});

test("earlier stages still activate before scored full count", () => {
  const idx = activeChecklistIndex({
    effectiveIndex: 5,
    legCount: 0,
    scoredLegCount: 2,
    requestedLegs: 6,
    checklist: [...CHECKLIST],
  });
  assert.equal(CHECKLIST[idx].label, "Line value calculated");
});

import assert from "node:assert/strict";
import test from "node:test";

/**
 * Mirrors AnalysisProgress active-checklist selection for build mode.
 * Never spin "Final ticket ready" while cards are still missing.
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
  const legCount = opts.legCount ?? 0;
  const flags = checklistDoneFlags({
    effectiveIndex: opts.effectiveIndex,
    legCount,
    scoredLegCount: opts.scoredLegCount ?? 0,
    requestedLegs: opts.requestedLegs ?? 0,
    checklist: opts.checklist,
  });
  let idx = flags.findIndex((done, i) => {
    if (done) return false;
    if (legCount === 0 && opts.checklist[i]?.label === "Final ticket ready") {
      return false;
    }
    return true;
  });
  if (idx < 0 && legCount === 0) {
    idx = opts.checklist.findIndex((c) => c.label === "Correlation scored");
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

test("board-scan wait never spins Final ticket ready without cards", () => {
  // maxAuto 7 / scored full-count both used to land on Final with an empty bubble.
  const idxEmpty = activeChecklistIndex({ effectiveIndex: 7, checklist: [...CHECKLIST] });
  assert.equal(CHECKLIST[idxEmpty].label, "Correlation scored");
  const idxScored = activeChecklistIndex({
    effectiveIndex: 5,
    legCount: 0,
    scoredLegCount: 6,
    requestedLegs: 6,
    checklist: [...CHECKLIST],
  });
  assert.equal(CHECKLIST[idxScored].label, "Correlation scored");
});

test("scored 6 of 6 with mid effectiveIndex stays on Correlation until cards land", () => {
  const idx = activeChecklistIndex({
    effectiveIndex: 5,
    legCount: 0,
    scoredLegCount: 6,
    requestedLegs: 6,
    checklist: [...CHECKLIST],
  });
  assert.equal(CHECKLIST[idx].label, "Correlation scored");
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

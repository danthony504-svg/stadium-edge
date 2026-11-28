import assert from "node:assert/strict";
import test from "node:test";
import { coachCanStartRemainingGameLines, coachGameLinePasses, coachGameSideCounts } from "./coachGameLineOrder.ts";
import { summarizeCoachGameLineDecisions } from "./coachGameLineProgress.ts";
import { coachLineHoldReason } from "./coachSpreadPolicy.ts";

test("large Coach board separates every moneyline ahead of the first alternate", () => {
  const entries: [string, { market: string; pick: string }[]][] = Array.from(
    { length: 500 },
    (_, i) => [`Game ${i}`, [
      ...Array.from({ length: 12 }, (_, side) => ({ market: "Alt Handicap", pick: `Selection ${side}` })),
      { market: "Moneyline", pick: "Away" },
      { market: "1H Moneyline", pick: "Home" },
    ]],
  );
  const { moneylines, remaining } = coachGameLinePasses(entries);
  const ordered = [...moneylines.values(), ...remaining.values()].flat();
  assert.equal(ordered.length, 7000);
  assert.equal(ordered.findIndex(side => side.market !== "Moneyline"), 500);
  assert.equal(remaining.size, 500);
});

test("alternate cap holds both spread and total sides before applying fixed ordering", () => {
  const eligible = [
    { market: "Alt Spread", pick: "Away +1.5" },
    { market: "Alt Total", pick: "Over 42.5" },
    ...Array.from({ length: 16 }, (_, i) => ({ market: "1H Moneyline", pick: `Team ${String(i).padStart(2, "0")}`, edge: i })),
    { market: "Moneyline", pick: "Away" },
  ];
  const split = (lines: typeof eligible) => coachGameSideCounts(lines, side => coachLineHoldReason(side) === "check_line", 12);
  const { held, scoreable, capped } = split(eligible);
  assert.deepEqual(held.map(side => side.market), ["Alt Spread", "Alt Total"]);
  assert.equal(scoreable.length, 13);
  assert.equal(capped.length, 4);
  assert.deepEqual(scoreable, split([...eligible].reverse()).scoreable);
  assert.equal(scoreable.at(-1)?.pick, "Team 11");
});

test("evaluated, scored and rejected sides have separate denominators", () => {
  const progress = summarizeCoachGameLineDecisions([
    "ok", "ok", "ok", "grade_floor", "simulation_or_grade_unavailable",
  ]);
  assert.deepEqual(progress, {
    evaluated: 5, scored: 4, rejected: 2,
    firstRejections: ["below grade floor 1", "simulation or grade unavailable 1"],
  });
});

test("alternates never start when the completed moneyline pass uses the scoring budget", () => {
  const { moneylines, remaining } = coachGameLinePasses([
    ["Game", [{ market: "Moneyline", pick: "Away" }, { market: "1H Moneyline", pick: "Home" }]],
  ]);
  const budgetMs = 30_000;
  const options = {
    aborted: false,
    moneylinePassComplete: true,
    gamePhaseRemainingMs: Infinity,
    scoringRemainingMs: budgetMs,
  };
  const evaluated = [];
  for (const lines of moneylines.values()) {
    evaluated.push(...lines.map(line => line.pick));
    options.scoringRemainingMs -= budgetMs;
  }
  if (coachCanStartRemainingGameLines(options)) {
    evaluated.push(...[...remaining.values()].flat().map(line => line.pick));
  }
  assert.deepEqual(evaluated, ["Away"]);
  assert.equal(remaining.size, 1);
  assert.equal(coachCanStartRemainingGameLines({ ...options, scoringRemainingMs: 1 }), true);
  assert.equal(coachCanStartRemainingGameLines({ ...options, scoringRemainingMs: 1, aborted: true }), false);
});

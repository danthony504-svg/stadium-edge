/**
 * node:test entry — runs the Coach QA harness and asserts it produces a report.
 * Does not change production Coach behavior.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { generateRequestMatrix, sequentialTransitionSeeds } from "./matrix.ts";
import { snapshotAsk } from "./parseSnapshot.ts";
import { checkSequentialTransition } from "./invariants.ts";
import { runCoachQaHarness, COACH_QA_SEED, screenshotSequenceAudit } from "./runCoachQa.ts";

test("request matrix covers legs 2–15 and all DEFAULT sports tags", () => {
  const matrix = generateRequestMatrix();
  assert.ok(matrix.length > 200, `matrix too small: ${matrix.length}`);
  for (let n = 2; n <= 15; n++) {
    assert.ok(
      matrix.some((c) => c.ask === `${n} leg`),
      `missing generic ${n} leg`,
    );
  }
  for (const sport of ["nfl", "nhl", "mlb", "nba", "soccer", "ncaaf", "ncaab", "wnba"]) {
    assert.ok(
      matrix.some((c) => c.tags.includes(sport)),
      `missing sport tag ${sport}`,
    );
  }
});

test("screenshot sequence: 4 leg soccer → 5 leg inherits propsOnly (known leak)", () => {
  const audit = screenshotSequenceAudit();
  assert.equal(audit.stalePropsOnlyConfirmed, true);
  const clean = snapshotAsk("5 leg", []);
  assert.equal(clean.propsOnly, false);
  assert.equal(clean.isMarketLocked, false);
  const stale = snapshotAsk("5 leg", ["4 leg soccer"]);
  assert.equal(stale.propsOnly, true);
  assert.equal(stale.isMarketLocked, false);
});

test("sequential seeds: TD/yards/sacks market lock resets on bare 5 leg", () => {
  for (const first of ["5 leg touchdowns", "5 leg passing yards", "5 leg sacks"]) {
    const alone = snapshotAsk("5 leg", []);
    const after = snapshotAsk("5 leg", [first]);
    assert.equal(after.isMarketLocked, false, first);
    assert.deepEqual(after.allowedMarketKeys, alone.allowedMarketKeys);
  }
});

test("sequential seed suite flags soccer→5 leg propsOnly leak", () => {
  const results = checkSequentialTransition(
    "soccer-to-bare",
    "4 leg soccer",
    "5 leg",
    ["propsOnly", "sport", "marketLock"],
  );
  assert.ok(results.some((r) => !r.ok && r.finding?.category === "state_leak"));
});

test("run full Coach QA harness and write report artifacts", () => {
  const outDir = join(
    process.cwd(),
    "lib/coachQa/reports",
  );
  mkdirSync(outDir, { recursive: true });
  const { report, markdown, screenshot } = runCoachQaHarness({
    seed: COACH_QA_SEED,
    fuzzSequential: 1000,
    fuzzParser: 500,
    autoSequential: 200,
    outDir,
  });

  assert.ok(report.totals.tests > 1000, `expected large suite, got ${report.totals.tests}`);
  assert.ok(markdown.includes("AI COACH QA REPORT"));
  assert.equal(screenshot.stalePropsOnlyConfirmed, true);

  // Also mirror to /opt/cursor/artifacts when available
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync("/opt/cursor/artifacts/coach-qa-report.md", markdown);
    writeFileSync(
      "/opt/cursor/artifacts/coach-qa-report-summary.json",
      JSON.stringify(
        {
          totals: report.totals,
          byCategory: report.byCategory,
          findingCount: report.findings.length,
          screenshot,
          seed: report.seed,
        },
        null,
        2,
      ),
    );
  } catch {
    // optional
  }

  console.log(
    `QA harness: tests=${report.totals.tests} passed=${report.totals.passed} failed=${report.totals.failed} warnings=${report.totals.warnings}`,
  );
});

test("sequentialTransitionSeeds includes required phone pairs", () => {
  const ids = new Set(sequentialTransitionSeeds().map((s) => s.id));
  for (const id of [
    "td-to-bare",
    "soccer-to-bare",
    "passyds-to-nba",
    "nhl-exclude-to-nhl",
    "yankees-to-bare",
  ]) {
    assert.ok(ids.has(id), id);
  }
});

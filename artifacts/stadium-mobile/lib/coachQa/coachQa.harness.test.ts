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

test("screenshot sequence: 4 leg soccer → 5 leg does NOT inherit propsOnly (RC1 fix)", () => {
  const audit = screenshotSequenceAudit();
  assert.equal(audit.stalePropsOnlyConfirmed, false);
  const clean = snapshotAsk("5 leg", []);
  assert.equal(clean.propsOnly, false);
  assert.equal(clean.isMarketLocked, false);
  const after = snapshotAsk("5 leg", ["4 leg soccer"]);
  assert.equal(after.propsOnly, false);
  assert.equal(after.isMarketLocked, false);
  assert.equal(after.pathHint, "full_board_mix");
  // Current-request props intent still works.
  assert.equal(snapshotAsk("5 player props", []).propsOnly, true);
  assert.equal(snapshotAsk("5 leg player props", []).propsOnly, true);
});

test("sequential seeds: TD/yards/sacks market lock resets on bare 5 leg", () => {
  for (const first of ["5 leg touchdowns", "5 leg passing yards", "5 leg sacks"]) {
    const alone = snapshotAsk("5 leg", []);
    const after = snapshotAsk("5 leg", [first]);
    assert.equal(after.isMarketLocked, false, first);
    assert.deepEqual(after.allowedMarketKeys, alone.allowedMarketKeys);
  }
});

test("sequential seed: soccer→5 leg propsOnly no longer leaks (RC1)", () => {
  const results = checkSequentialTransition(
    "soccer-to-bare",
    "4 leg soccer",
    "5 leg",
    ["propsOnly", "sport", "marketLock"],
  );
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
  const afterProps = checkSequentialTransition(
    "playerprops-to-bare",
    "5 leg player props",
    "5 leg",
    ["propsOnly", "marketLock"],
  );
  assert.ok(afterProps.every((r) => r.ok));
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
  assert.equal(screenshot.stalePropsOnlyConfirmed, false);

  // All P1/P2 RCs cleared — remaining findings should be warnings only.
  const failFindings = report.findings.filter(
    (f) =>
      !String(f.title).startsWith("Live failure-injection") &&
      f.title !== "Suspicious prop flagged for review",
  );
  const p1 = failFindings.filter((f) => f.severity === "P1");
  const p2 = failFindings.filter((f) => f.severity === "P2");
  assert.equal(p1.length, 0, `unexpected P1: ${p1.slice(0, 5).map((f) => f.title).join("; ")}`);
  assert.equal(p2.length, 0, `unexpected P2: ${p2.slice(0, 5).map((f) => f.title).join("; ")}`);
  assert.equal(report.totals.failed, 0, `expected 0 failed, got ${report.totals.failed}`);

  // RC1 must stay fixed after RC3.
  assert.equal(
    snapshotAsk("5 leg", ["4 leg soccer"]).propsOnly,
    false,
    "RC1 regression: soccer→5 leg must not inherit propsOnly",
  );

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
          p1Remaining: p1.length,
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

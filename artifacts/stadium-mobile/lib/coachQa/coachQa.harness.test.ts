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
import {
  assertAbsoluteTerminalClearsBusyOnHungScan,
  runAbsoluteTerminalHangGuardSuite,
} from "./terminalInvariant.ts";
import { runProductionTerminalAbAudit } from "./terminalLiveAudit.ts";

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

test("terminal invariant: absolute hang-guard suite (sync)", () => {
  const cases = runAbsoluteTerminalHangGuardSuite();
  assert.ok(cases.length >= 3);
  for (const c of cases) {
    assert.equal(c.ok, true, c.finding ? JSON.stringify(c.finding) : c.id);
  }
});

test("terminal invariant: hung scan must clear busy via absolute terminal", async () => {
  const result = await assertAbsoluteTerminalClearsBusyOnHungScan();
  assert.equal(result.ok, true, result.finding ? JSON.stringify(result.finding) : result.id);
});

/**
 * Production-equivalent A/B terminal gate.
 * Parser suites alone must not pass while the real async pipeline hangs on
 * "Scoring game lines… props/alts next (N posted)".
 *
 * Skip only when explicitly disabled (offline CI without network). Default ON
 * when EXPO_PUBLIC_DOMAIN points at production/staging.
 */
test(
  "terminal invariant: live A/B pipeline must reach a terminal state",
  { timeout: 300_000 },
  async (t) => {
    if (process.env.COACH_QA_SKIP_LIVE_TERMINAL === "1") {
      t.skip("COACH_QA_SKIP_LIVE_TERMINAL=1");
      return;
    }
    // API_BASE is fixed at module load from EXPO_PUBLIC_DOMAIN (see package.json
    // test:coach-qa default). Refuse a relative /api base — that cannot hit prod.
    const { API_BASE } = await import("../apiBase.ts");
    assert.match(
      API_BASE,
      /^https:\/\//,
      `live terminal audit needs absolute API_BASE, got ${API_BASE}`,
    );
    const { cases, summaries } = await runProductionTerminalAbAudit();
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/coach-5leg-terminal-ab.json",
        JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2),
      );
    } catch {
      // optional
    }
    for (const c of cases) {
      assert.equal(
        c.ok,
        true,
        c.finding
          ? `${c.finding.title}: ${c.finding.actual}`
          : JSON.stringify(c.meta),
      );
    }
    // Phone sequence B2 must not inherit propsOnly limbo — terminal with finite runtime.
    const b2 = summaries.find((s) => s.label === "B2_after_soccer");
    assert.ok(b2, "missing B2_after_soccer");
    assert.equal(b2!.terminalReached, true);
    assert.ok(
      (b2!.postedCandidates ?? 0) > 0 || b2!.finalLegs >= 0,
      "B2 should load a board or honest-empty",
    );
  },
);

/**
 * Phase 2 performance measurement gate (no invented fail timeout yet).
 * Ensures live odds/props/simulate stay uncacheable and records cold/warm
 * walls when live profiling is enabled — parser suites alone cannot pretend
 * the async path was measured.
 */
test("phase2 context cache never classifies live odds/props/simulate as cacheable", async () => {
  const { classifyCoachContextPath } = await import("../coachContextCache.ts");
  for (const p of [
    "/sports/odds?sport=nfl",
    "/sports/live-odds?sport=mlb",
    "/sports/props?sport=nba&eventId=1",
    "/sports/simulate/props",
    "/sports/simulate/game-outcome",
  ]) {
    assert.equal(classifyCoachContextPath(p), null, p);
  }
  for (const p of [
    "/sports/player-history?athleteId=1",
    "/sports/injuries?sport=nfl",
    "/sports/team-defense?sport=nfl&teamId=1",
    "/sports/matchup-history?sport=nfl&homeTeamId=1&awayTeamId=2",
  ]) {
    assert.ok(classifyCoachContextPath(p), p);
  }
});

test(
  "phase2 performance measurement: record cold/warm 5 leg walls when enabled",
  { timeout: 420_000 },
  async (t) => {
    if (process.env.COACH_QA_RUN_PERF_MEASURE !== "1") {
      t.skip("Set COACH_QA_RUN_PERF_MEASURE=1 to record live cold/warm walls");
      return;
    }
    const { clearCoachContextCache, coachCacheSnapshot, resetCoachCacheStats } =
      await import("../coachContextCache.ts");
    const { buildCoachParlay } = await import("../coach/buildParlay.ts");

    async function once(clear: boolean) {
      if (clear) clearCoachContextCache();
      resetCoachCacheStats();
      const t0 = performance.now();
      const ac = new AbortController();
      const kill = setTimeout(() => ac.abort(), 300_000);
      try {
        const r = await buildCoachParlay({
          requestedLegs: 5,
          askText: "5 leg",
          priorUserTexts: [],
          signal: ac.signal,
        });
        return {
          ms: Math.round(performance.now() - t0),
          legs: r.picks.length,
          posted: r.propPoolSize,
          cache: coachCacheSnapshot(),
        };
      } finally {
        clearTimeout(kill);
      }
    }

    const cold = await once(true);
    const warm = await once(false);
    const payload = {
      generatedAt: new Date().toISOString(),
      note: "Measurement only — fail threshold deferred until distribution agreed",
      phase1Baseline: { coldMs: 51_300, warmMs: 20_300 },
      prePhase2Baseline: { coldMs: 42_000, warmMs: 27_700 },
      cold,
      warm,
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/coach-phase2-perf-measure.json",
        JSON.stringify(payload, null, 2),
      );
    } catch {
      /* optional */
    }
    assert.ok(cold.ms > 0 && warm.ms > 0);
    assert.ok(cold.legs >= 0 && warm.legs >= 0);
    console.log(
      `phase2 measure cold=${cold.ms}ms warm=${warm.ms}ms warmHits=${warm.cache.stages.reduce((a, s) => a + s.cacheHit, 0)}`,
    );
  },
);

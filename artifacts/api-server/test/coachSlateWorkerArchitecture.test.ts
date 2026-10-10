/**
 * Eight-test plan for Render Cron Job slate worker architecture.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  coachSlateApiBase,
  coachSlateSimsInProcess,
} from "../src/lib/coachSlateLoopback.ts";
import { shouldPublishCoachSlateSnapshot } from "../src/lib/coachSlatePublish.ts";
import {
  coachSlateGetMayStartJob,
  coachSlateNeedsRefresh,
  hasUsableCoachSlateSnapshot,
} from "../src/lib/coachSlateGetPolicy.ts";
import { normalizeCoachPrecomputedSlateRow } from "../src/lib/coachSlateRow.ts";
import { COACH_SLATE_LOCK_CLASS, COACH_SLATE_LOCK_ID } from "../src/lib/coachSlateJobLock.ts";
import { DEEP_SIMULATIONS, QUICK_SIMULATIONS } from "../src/lib/monteCarlo.ts";
import { tierSimCount } from "../src/lib/propSimRunner.ts";

const srcDir = join(import.meta.dirname, "../src");

// 1) API base uses env; not forced to localhost when set
test("1: coachSlateApiBase uses COACH_SLATE_API_BASE (not localhost)", () => {
  const prev = process.env.COACH_SLATE_API_BASE;
  process.env.COACH_SLATE_API_BASE = "https://stadium-edge.onrender.com/api/";
  try {
    assert.equal(coachSlateApiBase(), "https://stadium-edge.onrender.com/api");
    assert.doesNotMatch(coachSlateApiBase(), /127\.0\.0\.1|localhost/i);
  } finally {
    if (prev == null) delete process.env.COACH_SLATE_API_BASE;
    else process.env.COACH_SLATE_API_BASE = prev;
  }
});

// 2) Incomplete must not publish / overwrite complete global
test("2: shouldPublishCoachSlateSnapshot rejects incomplete partials", () => {
  assert.equal(shouldPublishCoachSlateSnapshot({ deepSimComplete: false }), false);
  assert.equal(shouldPublishCoachSlateSnapshot({ deepSimComplete: true }), true);
  assert.equal(shouldPublishCoachSlateSnapshot(null), false);
  const storeSrc = readFileSync(join(srcDir, "lib/coachSlateStore.ts"), "utf8");
  assert.match(storeSrc, /shouldPublishCoachSlateSnapshot/);
  assert.match(storeSrc, /refusing to publish incomplete/);
});

// 3) GET never serves incomplete as complete/usable
test("3: GET policy rejects incomplete snapshots as unusable", () => {
  const at = Date.now() - 60_000;
  const incomplete = normalizeCoachPrecomputedSlateRow({
    data: {
      at,
      fingerprint: "fp",
      built: {
        context: {
          selectedSports: ["nfl"],
          currentSlip: [],
          realGames: [],
          realOdds: [],
          realProps: [],
        },
        propPool: [],
        gameMeta: [],
        upsetSpots: [],
        todayOnly: false,
        tomorrowOnly: false,
      },
      propSimulations: [],
      boardScan: { picks: [{ game: "A @ B" }], totalScanned: 1, totalQualified: 1 },
      tickets: { global: {}, bySport: {} },
      activeSports: ["nfl"],
      deepSimComplete: false,
    },
    updatedAt: new Date(at),
    deepSimComplete: false,
  });
  assert.equal(incomplete.fresh, true);
  assert.equal(hasUsableCoachSlateSnapshot(incomplete), false);
  assert.equal(coachSlateNeedsRefresh(incomplete), true);
  assert.equal(coachSlateGetMayStartJob(incomplete), false);

  const policySrc = readFileSync(join(srcDir, "lib/coachSlateGetPolicy.ts"), "utf8");
  assert.doesNotMatch(policySrc, /global:building/);
});

// 4) Lock-held path is a skip (source + constants)
test("4: advisory lock constants and lock-held skip reason exist", () => {
  assert.equal(COACH_SLATE_LOCK_CLASS, 87251433);
  assert.equal(COACH_SLATE_LOCK_ID, 1);
  const jobsSrc = readFileSync(join(srcDir, "lib/coachSlateJobs.ts"), "utf8");
  assert.match(jobsSrc, /tryAcquireCoachSlateJobLock/);
  assert.match(jobsSrc, /lock-held/);
  assert.match(jobsSrc, /lock\.release/);
  const lockSrc = readFileSync(join(srcDir, "lib/coachSlateJobLock.ts"), "utf8");
  assert.match(lockSrc, /pg_try_advisory_lock/);
  assert.match(lockSrc, /pg_advisory_unlock/);
});

// 5) In-process sims use same tier counts; adapters wired
test("5: in-process sim path uses DEEP/QUICK counts and is wired for worker", () => {
  assert.equal(tierSimCount("deep"), DEEP_SIMULATIONS);
  assert.equal(tierSimCount("quick"), QUICK_SIMULATIONS);
  assert.equal(DEEP_SIMULATIONS, 10_000);
  assert.equal(QUICK_SIMULATIONS, 1_000);

  const prevW = process.env.COACH_SLATE_WORKER;
  const prevM = process.env.COACH_SLATE_SIM_MODE;
  process.env.COACH_SLATE_WORKER = "1";
  try {
    assert.equal(coachSlateSimsInProcess(), true);
  } finally {
    if (prevW == null) delete process.env.COACH_SLATE_WORKER;
    else process.env.COACH_SLATE_WORKER = prevW;
    if (prevM == null) delete process.env.COACH_SLATE_SIM_MODE;
    else process.env.COACH_SLATE_SIM_MODE = prevM;
  }

  const boardSrc = readFileSync(join(srcDir, "lib/coachSlateBoardScan.ts"), "utf8");
  assert.match(boardSrc, /runPropSimsInProcess/);
  assert.match(boardSrc, /coachSlateSimsInProcess/);
  const gameSrc = readFileSync(join(srcDir, "lib/coachSlateGameSims.ts"), "utf8");
  assert.match(gameSrc, /runGameOutcomeSimInProcess/);
  const inprocSrc = readFileSync(join(srcDir, "lib/coachSlateInProcessSims.ts"), "utf8");
  assert.match(inprocSrc, /runPropSims/);
  assert.match(inprocSrc, /tierSimCount/);
  assert.match(inprocSrc, /DEEP_SIMULATIONS/);
});

// 6) Web cron path disabled unless override
test("6: web POST /coach/slate/cron returns 410 unless COACH_SLATE_RUN_ON_WEB=1", () => {
  const routeSrc = readFileSync(join(srcDir, "routes/coachSlate.ts"), "utf8");
  assert.match(routeSrc, /COACH_SLATE_RUN_ON_WEB/);
  assert.match(routeSrc, /use_render_cron_worker/);
  assert.match(routeSrc, /410/);
  // Heavy await only after override gate
  const idxGate = routeSrc.indexOf('COACH_SLATE_RUN_ON_WEB !== "1"');
  const idxAwait = routeSrc.indexOf("await runCoachSlateJob()");
  assert.ok(idxGate >= 0 && idxAwait > idxGate);
});

// 7) Existing readonly invariants still hold + no partial publish in jobs
test("7: GET remains read-only; jobs do not publish partials to global", () => {
  const routeSrc = readFileSync(join(srcDir, "routes/coachSlate.ts"), "utf8");
  assert.doesNotMatch(routeSrc, /scheduleCoachSlateRefresh\s*\(/);
  assert.match(routeSrc, /READ-ONLY/);
  assert.equal(coachSlateGetMayStartJob({ snapshot: null, fresh: false, instantServe: false }), false);

  const jobsSrc = readFileSync(join(srcDir, "lib/coachSlateJobs.ts"), "utf8");
  // Final persist only — no onPartial persist callback publishing incompletes
  assert.doesNotMatch(jobsSrc, /onPartial:\s*async/);
  assert.match(jobsSrc, /deepSimComplete:\s*true/);
  assert.match(jobsSrc, /persistCoachPrecomputedSlate\(snapshot\)/);
});

// 8) Worker CLI + build entry + phase metrics present (staging smoke prerequisites)
test("8: worker CLI rejects localhost API base; phase metrics + build entry exist", () => {
  const workerSrc = readFileSync(join(srcDir, "coachSlateWorker.ts"), "utf8");
  assert.match(workerSrc, /COACH_SLATE_API_BASE/);
  assert.match(workerSrc, /localhost/);
  assert.match(workerSrc, /127\\.0\\.0\\.1/);
  assert.match(workerSrc, /runCoachSlateJob/);
  assert.match(workerSrc, /process\.exit/);

  const buildSrc = readFileSync(join(import.meta.dirname, "../build.mjs"), "utf8");
  assert.match(buildSrc, /coachSlateWorker\.ts/);

  const metricsSrc = readFileSync(join(srcDir, "lib/coachSlatePhaseMetrics.ts"), "utf8");
  assert.match(metricsSrc, /rssMb/);
  assert.match(metricsSrc, /logCoachSlatePhase/);
  const jobsSrc = readFileSync(join(srcDir, "lib/coachSlateJobs.ts"), "utf8");
  assert.match(jobsSrc, /logCoachSlatePhase/);
  assert.match(jobsSrc, /peakRssMb/);
});

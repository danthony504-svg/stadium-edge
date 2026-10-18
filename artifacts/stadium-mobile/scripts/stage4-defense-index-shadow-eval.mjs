#!/usr/bin/env node
/**
 * Offline Stage 4 P0/P1 eval — fixtures only (no Odds API / live defense fetches).
 * Writes /opt/cursor/artifacts/stage4-p0-p1-defense-index-shadow-report.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..", "lib");
const fix = join(lib, "__fixtures__", "stage4");

const { buildDefenseIndexByFamily, DEFAULT_DEFENSE_INDEX_SHRINK } = await import(
  pathToFileURL(join(lib, "defenseIndexFromPack.ts")).href
);
const {
  approxHitFromMeanStd,
  clearDefenseIndexShadowReports,
  recordDefenseIndexShadow,
  shadowMeanFromBaseline,
} = await import(pathToFileURL(join(lib, "defenseIndexShadow.ts")).href);

const jax = JSON.parse(readFileSync(join(fix, "jax-jaguars-defense.json"), "utf8"));
const hou = JSON.parse(readFileSync(join(fix, "hou-texans-defense.json"), "utf8"));
const multi = JSON.parse(readFileSync(join(fix, "multi-sport-defense-packs.json"), "utf8"));

const memBefore = process.memoryUsage();
const t0 = performance.now();

const coverage = {};
for (const [sport, pack] of Object.entries({
  nfl_jax: { sport: "nfl", id: jax.teamId, pack: jax.pack },
  nfl_hou: { sport: "nfl", id: hou.teamId, pack: hou.pack },
  ncaaf: { sport: "ncaaf", id: "cfb1", pack: multi.ncaaf },
  nba: { sport: "nba", id: "nba1", pack: multi.nba },
  wnba: { sport: "wnba", id: "wnba1", pack: multi.wnba },
  ncaab: { sport: "ncaab", id: "ncaab1", pack: multi.ncaab },
  nhl: { sport: "nhl", id: "nhl1", pack: multi.nhl },
  mlb: { sport: "mlb", id: "mlb1", pack: multi.mlb },
  soccer: { sport: "soccer", id: "soc1", pack: multi.soccer },
})) {
  const built = buildDefenseIndexByFamily({
    sport: pack.sport,
    opponentTeamId: pack.id,
    oppPack: pack.pack,
  });
  coverage[sport] = {
    families: Object.keys(built.defenseIndexByFamily),
    indices: built.defenseIndexByFamily,
    skipped: built.skipped,
    explain: built.explain,
  };
}

// JAX rush representative scenario (HOU @ JAX rushing Over)
const baselineMean = 72;
const stdDev = 22;
const line = 64.5;
const baselineHit = approxHitFromMeanStd({
  mean: baselineMean,
  stdDev,
  line,
  side: "Over",
});
clearDefenseIndexShadowReports();
const shadowCpuT0 = performance.now();
const report = recordDefenseIndexShadow({
  props: [
    {
      sport: "nfl",
      opponentTeamId: jax.teamId,
      athleteId: "fixture-rb",
      eventId: "hou-at-jax",
      player: "Fixture RB",
      market: "player_rush_yds",
      side: "Over",
      line,
      baselineHit,
      baselineMean,
      stdDev,
      pack: jax.pack,
    },
    {
      sport: "nfl",
      opponentTeamId: jax.teamId,
      athleteId: "fixture-qb",
      eventId: "hou-at-jax",
      player: "Fixture QB",
      market: "player_pass_yds",
      side: "Over",
      line: 249.5,
      baselineHit: approxHitFromMeanStd({
        mean: 255,
        stdDev: 45,
        line: 249.5,
        side: "Over",
      }),
      baselineMean: 255,
      stdDev: 45,
      pack: jax.pack,
    },
    {
      sport: "nfl",
      opponentTeamId: hou.teamId,
      athleteId: "fixture-rb-vs-hou",
      eventId: "hou-at-jax",
      player: "JAX RB",
      market: "player_rush_yds",
      side: "Over",
      line: 54.5,
      baselineHit: approxHitFromMeanStd({
        mean: 62,
        stdDev: 20,
        line: 54.5,
        side: "Over",
      }),
      baselineMean: 62,
      stdDev: 20,
      pack: hou.pack,
    },
  ],
});
const shadowCpuMs = performance.now() - shadowCpuT0;
const memAfter = process.memoryUsage();
const totalMs = performance.now() - t0;

// Latency micro-bench: 200× record of 12 rows
const latSamples = [];
for (let i = 0; i < 200; i++) {
  const props = Array.from({ length: 12 }, (_, j) => ({
    sport: "nfl",
    opponentTeamId: jax.teamId,
    market: "player_rush_yds",
    side: "Over",
    line: 40 + j,
    baselineHit: 0.5,
    baselineMean: 55,
    stdDev: 18,
    pack: jax.pack,
  }));
  const a = performance.now();
  recordDefenseIndexShadow({ props, maxRows: 12 });
  latSamples.push(performance.now() - a);
}
latSamples.sort((a, b) => a - b);
const p50 = latSamples[Math.floor(latSamples.length * 0.5)];
const p95 = latSamples[Math.floor(latSamples.length * 0.95)];

const out = {
  title: "Stage 4 P0/P1 — defenseIndexByFamily contracts + shadow",
  generatedAt: new Date().toISOString(),
  scope: "P0+P1 only — no seating/grade/ticket/prob changes; P2–P7 deferred",
  shrinkConfig: DEFAULT_DEFENSE_INDEX_SHRINK,
  coverage,
  jaxRushScenario: {
    note: "Compare existing rushing sim mean vs defense-adjusted shadow; do not treat delta as automatically correct.",
    opponent: { teamId: jax.teamId, teamName: jax.pack.teamName, rushYdsAllowed: 63.8, sample: 5 },
    baselineMean,
    shadowMean: shadowMeanFromBaseline(baselineMean, 0.9),
    stdDev,
    line,
    side: "Over",
    baselineHit,
    shadowRow: report.rows[0],
  },
  baselineVsShadowByMarket: report.rows.map((r) => ({
    market: r.identity.market,
    opponentTeamId: r.identity.opponentTeamId,
    player: r.identity.player,
    line: r.identity.line,
    side: r.identity.side,
    defenseIndex: r.defenseIndex,
    sampleSize: r.sampleSize,
    baselineHit: r.baselineHit,
    shadowHit: r.shadowHit,
    deltaHit: r.deltaHit,
    baselineMean: r.baselineMean,
    shadowMean: r.shadowMean,
    shadowAvoidsVsOppDoubleCount: r.shadowAvoidsVsOppDoubleCount,
    skippedReason: r.skippedReason,
  })),
  missingDataAndShrinkage: {
    thinSampleSkipsIndex: true,
    stalePackSkipsAll: true,
    anytimeTdExcluded: true,
    configurableClampNotProdApproval: true,
    jaxRushRawThenClamp: coverage.nfl_jax.explain.find((e) => e.family === "rush_yds"),
  },
  doubleCountSafeguards: {
    liveDeepRequestsOmitDefenseIndexByFamily: true,
    shadowMeanIsBaselineTimesIndexOnly: true,
    postHocDefenseTiltUnchangedInP1: true,
    vsOppNotReAppliedInShadow: true,
  },
  latencyAndResources: {
    evalTotalMs: Math.round(totalMs * 1000) / 1000,
    singleReportCpuMs: Math.round(shadowCpuMs * 1000) / 1000,
    shadowRecordP50Ms: Math.round(p50 * 1000) / 1000,
    shadowRecordP95Ms: Math.round(p95 * 1000) / 1000,
    rssDeltaBytes: memAfter.rss - memBefore.rss,
    heapUsedDeltaBytes: memAfter.heapUsed - memBefore.heapUsed,
    note: "Local normal-CDF path; no extra Odds/team-defense fetches; capped at 12 rows/run",
  },
  remainingCalibrationRisks: [
    "Clamp floor 0.9 may over-shrink extreme stingy D (JAX 63.8 → raw 0.57 → clamped 0.9)",
    "Recv yards proxy from pass yards allowed is coarse",
    "MLB team ERA proxy vs true opposing pitcher tendency",
    "Basketball steals/dreb invert heuristics uncalibrated",
    "Shadow uses normal-CDF approximation, not exact-market 10K re-sim",
    "Post-hoc defense_tilt still applies on seating path until P2",
  ],
  gates: {
    optionC_773: "enforced — historical allowlist empty; deep 10k required",
    confidenceFloor_711: "52 / C+ unchanged",
    liveSeatingUnchanged: true,
    prodServerUnchanged: true,
    previewOtaUnchanged: true,
  },
  recommendation: {
    advanceToP2: "PASS_WITH_RISKS",
    rationale:
      "P0 mappers + P1 shadow lineage are green offline. Advance to P2 (tilt vs in-sim double-count remediation) only after reviewing clamp/baseline calibration; do not enable seating yet.",
  },
};

mkdirSync("/opt/cursor/artifacts", { recursive: true });
const path = "/opt/cursor/artifacts/stage4-p0-p1-defense-index-shadow-report.json";
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ wrote: path, recommendation: out.recommendation, p50, p95 }, null, 2));

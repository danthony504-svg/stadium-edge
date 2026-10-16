/**
 * Same fixed-seed 10k holdout harness, two engine commits, identical fixtures
 * and form preparation. Writes one comparison artifact.
 *
 * Corrected side: current tip (ppg-per-drive-v1 + ctx.random), which matches
 * 2c13a3ba conversion math (see drive-engine-commit-compare.json).
 * Legacy side: 013ddb88 engine files vendored into a temp runner that still
 * uses the shared walkHoldoutGames / blendVenueAndL10 / mulberry32 harness.
 *
 * Usage:
 *   NCAAF_PHASE_E_SIMS=10000 NCAAF_PHASE_E_PRIMARY_ONLY=1 \
 *     node --experimental-strip-types artifacts/api-server/scripts/dualCommitHoldoutCalib.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const OLD = "013ddb88";
const CORRECTED_DOC = "2c13a3ba77c3d3df9053b968bc463956d69f1d6f";
const SIMS = Number(process.env.NCAAF_PHASE_E_SIMS ?? 10000);
const PRIMARY_ONLY = process.env.NCAAF_PHASE_E_PRIMARY_ONLY !== "0";

async function runTipHarness(label) {
  const outPath = join(
    repoRoot,
    "artifacts/api-server/test/fixtures",
    `ncaaf-phase-e-calibration-report-${label}.json`,
  );
  const env = {
    ...process.env,
    NCAAF_PHASE_E_SIMS: String(SIMS),
    NCAAF_PHASE_E_PRIMARY_ONLY: PRIMARY_ONLY ? "1" : "0",
    NCAAF_PHASE_E_REPORT_PATH: outPath,
  };
  // Tip harness writes its own default path — copy after.
  const defaultPath = join(
    here,
    "../test/fixtures/ncaaf-phase-e-calibration-report.json",
  );
  const before = existsSync(defaultPath) ? readFileSync(defaultPath, "utf8") : null;
  try {
    execSync(
      `node --experimental-strip-types ${join(here, "ncaafPhaseEHoldoutCalibration.ts")}`,
      { cwd: join(here, ".."), env, stdio: "inherit", timeout: 0 },
    );
  } catch (e) {
    // exit 2 = P0 stay armed — still capture report
    console.error(`[${label}] harness exited`, e.status ?? e.message);
  }
  if (existsSync(defaultPath)) {
    const body = readFileSync(defaultPath, "utf8");
    writeFileSync(outPath, body);
    if (before) writeFileSync(defaultPath, before);
    return JSON.parse(body);
  }
  return null;
}

/**
 * Legacy 013ddb88 engine under the SAME form walk + seed + sims as tip.
 * Vendors nflDriveSim + footballDriveMatchup from 013ddb88 into /tmp and
 * runs a minimal holdout that imports tip's footballCalibration helpers.
 */
async function runLegacy013UnderSharedHarness() {
  const work = join(tmpdir(), `drive-cmp-013-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const matchup = execSync(
    `git show ${OLD}:artifacts/api-server/src/lib/sportSim/footballDriveMatchup.ts`,
    { encoding: "utf8", maxBuffer: 4e6 },
  );
  const sim = execSync(
    `git show ${OLD}:artifacts/api-server/src/lib/sportSim/nflDriveSim.ts`,
    { encoding: "utf8", maxBuffer: 4e6 },
  );
  writeFileSync(join(work, "footballDriveMatchup.ts"), matchup);
  // Patch legacy sim to accept ctx.random for fair fixed-seed compare.
  let simPatched = sim
    .replace(/Math\.random\(\)/g, "rng()")
    .replace(
      /const homeScores: number\[\] = \[\];/,
      "const rng = ctx.random ?? Math.random;\n  const homeScores: number[] = [];",
    );
  // scoreTouchdown / driveOutcome may need rng threaded — if bare Math.random
  // already replaced globally, ensure rng is in scope before first use.
  if (!/const rng = ctx\.random/.test(simPatched)) {
    simPatched = simPatched.replace(
      /const homeRate = footballDriveRateInput/,
      "const rng = ctx.random ?? Math.random;\n  const homeRate = footballDriveRateInput",
    );
  }
  writeFileSync(join(work, "nflDriveSim.ts"), simPatched);

  const runner = `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import {
  blendVenueAndL10,
} from ${JSON.stringify(join(work, "footballDriveMatchup.ts"))};
import { runNflDriveSim } from ${JSON.stringify(join(work, "nflDriveSim.ts"))};
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  mulberry32,
  walkHoldoutGames,
  dogCohort,
  DOG_COHORT_COVER_MAX,
  accountFootballCompletions,
} from ${JSON.stringify(join(here, "../src/lib/sportSim/footballCalibration.ts"))};

const SIMS = ${SIMS};
const seed = FOOTBALL_CALIBRATION_PRIMARY_SEED;
const fixture = ${JSON.stringify(join(here, "../test/fixtures/ncaaf-phase-e-games.json"))};
const games = JSON.parse(readFileSync(fixture, "utf8")).games
  .filter(g => g.season === 2024 && g.homeFg != null && g.awayFg != null);

const formByTeam = new Map();
function formOf(id) {
  if (!formByTeam.has(id)) formByTeam.set(id, { games: [], home: [], away: [] });
  return formByTeam.get(id);
}
function slice(arr) {
  const last = arr.slice(-10);
  if (!last.length) return null;
  const ptsFor = last.reduce((s, g) => s + g.for, 0) / last.length;
  const ptsAgainst = last.reduce((s, g) => s + g.against, 0) / last.length;
  return { games: last.length, ptsFor, ptsAgainst };
}

const rows = [];
let scored = 0, skippedThin = 0;
const rng = mulberry32(seed);
const availability = { includedByCompletedAt: 0, includedByKickoffPlusFourHours: 0, heldNotYetAvailable: 0 };

walkHoldoutGames(games, (g, priorHome, priorAway) => {
  const homeL10 = slice(formOf(g.homeTeamId).games);
  const awayL10 = slice(formOf(g.awayTeamId).games);
  const homeVenue = slice(formOf(g.homeTeamId).home);
  const awayVenue = slice(formOf(g.awayTeamId).away);
  const hb = blendVenueAndL10(homeVenue, homeL10);
  const ab = blendVenueAndL10(awayVenue, awayL10);
  // record this game into rolling form after selection (leakage-safe walk)
  formOf(g.homeTeamId).games.push({ for: g.homeFg, against: g.awayFg });
  formOf(g.awayTeamId).games.push({ for: g.awayFg, against: g.homeFg });
  formOf(g.homeTeamId).home.push({ for: g.homeFg, against: g.awayFg });
  formOf(g.awayTeamId).away.push({ for: g.awayFg, against: g.homeFg });

  if (hb.ptsFor == null || ab.ptsFor == null) { skippedThin++; return; }
  const result = runNflDriveSim({
    sport: "ncaaf",
    simulations: SIMS,
    random: rng,
    home: { ptsFor: hb.ptsFor, ptsAgainst: hb.ptsAgainst, yardsAllowed: null, games: homeL10?.games ?? 0 },
    away: { ptsFor: ab.ptsFor, ptsAgainst: ab.ptsAgainst, yardsAllowed: null, games: awayL10?.games ?? 0 },
  });
  if (!result) { skippedThin++; return; }
  const pHome = result.homeWinProbability;
  const yHome = g.homeFg > g.awayFg ? 1 : 0;
  const margin = g.awayFg - g.homeFg;
  const awayCovered75 = margin + 7.5 > 0 ? 1 : 0;
  rows.push({ eventId: g.eventId, pHome, yHome, awayCovered75 });
  scored++;
  if (scored % 100 === 0) console.error("legacy013 scored", scored);
}, availability);

const n = rows.length;
const meanP = n ? rows.reduce((s, r) => s + r.pHome, 0) / n : 0;
const meanY = n ? rows.reduce((s, r) => s + r.yHome, 0) / n : 0;
const brier = n ? rows.reduce((s, r) => s + (r.pHome - r.yHome) ** 2, 0) / n : 0;
const cohort = dogCohort(rows);
const report = {
  generatedAt: new Date().toISOString(),
  engineCommit: "${OLD}",
  engine: "nfl-drive:pre-ppg-per-drive (013ddb88 ×0.48 / ppg-as-ppd)",
  note: "Legacy engine under tip form walk + mulberry32(${SIMS} sims, seed " + seed + "). rng patched onto 013ddb88 sim for fair seed compare.",
  simulationsPerGame: SIMS,
  calibrationSeed: seed,
  nHoldoutScored: scored,
  nHoldoutSkippedThinForm: skippedThin,
  metrics: {
    brier,
    brierCoin: 0.25,
    meanP,
    meanY,
    homeWinBias: meanP - meanY,
    nearCoinFlipDog75: { n: cohort.n, awayCoverRate: cohort.awayCoverRate },
  },
  dogCoverCap: DOG_COHORT_COVER_MAX,
  formAvailability: availability,
  completions: accountFootballCompletions(games),
};
const out = ${JSON.stringify(join(here, "../test/fixtures/ncaaf-phase-e-calibration-report-013ddb88.json"))};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ scored, meanP, meanY, brier, cohort }, null, 2));
`;
  const runnerPath = join(work, "run013.mjs");
  // Use strip-types via renaming to .ts imports — write as .ts and run with strip-types
  const runnerTs = join(work, "run013.ts");
  writeFileSync(runnerTs, runner);
  try {
    execSync(`node --experimental-strip-types ${runnerTs}`, {
      stdio: "inherit",
      cwd: work,
      timeout: 0,
    });
  } catch (e) {
    console.error("legacy013 runner failed", e.status ?? e.message);
  }
  const outPath = join(
    here,
    "../test/fixtures/ncaaf-phase-e-calibration-report-013ddb88.json",
  );
  const body = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* keep for debug */
  }
  return body;
}

async function main() {
  console.error("=== dual-commit holdout: tip (≈2c13a3ba conversion) ===");
  const tip = await runTipHarness("tip-ppg-v1");
  console.error("=== dual-commit holdout: 013ddb88 engine under shared harness ===");
  const legacy = await runLegacy013UnderSharedHarness();

  const compare = {
    generatedAt: new Date().toISOString(),
    sims: SIMS,
    primaryOnly: PRIMARY_ONLY,
    correctedDocCommit: CORRECTED_DOC,
    tipReport: tip
      ? {
          engine: tip.engine,
          meanP: tip.metrics?.meanP,
          meanY: tip.metrics?.meanY,
          brier: tip.metrics?.brier,
          dog: tip.metrics?.nearCoinFlipDog75,
          n: tip.nHoldoutScored,
          seed: tip.calibrationSeed ?? tip.seedPolicy,
        }
      : null,
    legacy013: legacy
      ? {
          engine: legacy.engine,
          meanP: legacy.metrics?.meanP,
          meanY: legacy.metrics?.meanY,
          brier: legacy.metrics?.brier,
          dog: legacy.metrics?.nearCoinFlipDog75,
          n: legacy.nHoldoutScored,
          seed: legacy.calibrationSeed,
        }
      : null,
    delta:
      tip && legacy
        ? {
            meanP: tip.metrics.meanP - legacy.metrics.meanP,
            meanY: tip.metrics.meanY - legacy.metrics.meanY,
            brier: tip.metrics.brier - legacy.metrics.brier,
            dogCover:
              (tip.metrics.nearCoinFlipDog75?.awayCoverRate ?? null) != null &&
              (legacy.metrics.nearCoinFlipDog75?.awayCoverRate ?? null) != null
                ? tip.metrics.nearCoinFlipDog75.awayCoverRate -
                  legacy.metrics.nearCoinFlipDog75.awayCoverRate
                : null,
          }
        : null,
    explanation:
      "013ddb88 feeds points-per-game (×0.48 for NCAAF) into the per-drive rate map. 2c13a3ba/tip divides PPG by shared drive count and does not multiply by 0.48. Same fixtures, blendVenueAndL10 walk, primary seed 20241015, 10000 sims.",
  };

  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  const out = JSON.stringify(compare, null, 2);
  writeFileSync("/opt/cursor/artifacts/dual-commit-holdout-compare.json", out);
  writeFileSync(
    join(here, "../test/fixtures/dual-commit-holdout-compare.json"),
    out,
  );
  console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

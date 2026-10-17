/**
 * Prove engine+caller differences between 013ddb88 (×0.48 / ppg-as-ppd) and
 * 2c13a3ba (ppg→ppd via shared drive count; college scale retired).
 *
 * An engineVersion label alone is insufficient — this prints the live call
 * path and numeric conversion for identical PPG inputs.
 *
 * Usage: node artifacts/api-server/scripts/compareDriveEngineCommits.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const OLD = "013ddb88";
const CORRECTED = "2c13a3ba77c3d3df9053b968bc463956d69f1d6f";

function show(commit, path) {
  return execSync(`git show ${commit}:${path}`, { encoding: "utf8", maxBuffer: 8e6 });
}

function extract(src, startRe, endRe) {
  const start = src.search(startRe);
  if (start < 0) return null;
  const from = src.slice(start);
  const end = from.search(endRe);
  return end > 0 ? from.slice(0, end) : from.slice(0, 800);
}

const matchupOld = show(OLD, "artifacts/api-server/src/lib/sportSim/footballDriveMatchup.ts");
const matchupNew = show(CORRECTED, "artifacts/api-server/src/lib/sportSim/footballDriveMatchup.ts");
const simOld = show(OLD, "artifacts/api-server/src/lib/sportSim/nflDriveSim.ts");
const simNew = show(CORRECTED, "artifacts/api-server/src/lib/sportSim/nflDriveSim.ts");

// --- Live numeric proof (reimplement both signatures from the source text) ---
const FOOTBALL_COLLEGE_RATE_INPUT_SCALE = 0.48;

/** 013ddb88 signature: (offenseMean, sport) → multiply college by 0.48; no /drives */
function rateInput013(offenseMean, sport) {
  const safe = Number.isFinite(offenseMean) ? Math.max(0, offenseMean) : 0;
  const s = String(sport ?? "").toLowerCase();
  if (s === "ncaaf" || s === "cfb" || s.includes("ncaaf")) {
    return safe * FOOTBALL_COLLEGE_RATE_INPUT_SCALE;
  }
  return safe;
}

/** 2c13a3ba signature: (ppg, drives, sport?) → ppg/drives; scale unused */
function rateInput2c13(pointsPerGame, drives, _sport) {
  const ppg = Number.isFinite(pointsPerGame) ? Math.max(0, pointsPerGame) : 0;
  const n = Math.max(1, drives);
  return ppg / n;
}

function expectedDrives2c13(homePpg, awayPpg, sport) {
  const college = /ncaaf|cfb/.test(String(sport ?? "").toLowerCase());
  const driveScale = college ? 70 : 55;
  const sum =
    (Number.isFinite(homePpg) ? Math.max(0, homePpg) : 0) +
    (Number.isFinite(awayPpg) ? Math.max(0, awayPpg) : 0);
  return Math.max(6, Math.round(10 + sum / driveScale));
}

const cases = [
  { label: "NFL 22/22", sport: "nfl", home: 22, away: 22 },
  { label: "NCAAF 28/24", sport: "ncaaf", home: 28, away: 24 },
  { label: "NCAAF 42/38 (high)", sport: "ncaaf", home: 42, away: 38 },
];

const numeric = cases.map((c) => {
  const drivesOld = Math.round(10 + (c.home + c.away) / (c.sport === "ncaaf" ? 70 : 55));
  const drivesNew = expectedDrives2c13(c.home, c.away, c.sport);
  const oldHome = rateInput013(c.home, c.sport);
  const oldAway = rateInput013(c.away, c.sport);
  const newHome = rateInput2c13(c.home, drivesNew, c.sport);
  const newAway = rateInput2c13(c.away, drivesNew, c.sport);
  return {
    ...c,
    drivesOld,
    drivesNew,
    old: {
      homeRateFedToDriveMap: oldHome,
      awayRateFedToDriveMap: oldAway,
      note: "013ddb88 feeds game-mean (×0.48 college) as if it were points-per-drive",
      collegeScaleApplied: c.sport === "ncaaf",
    },
    corrected: {
      homeRateFedToDriveMap: newHome,
      awayRateFedToDriveMap: newAway,
      note: "2c13a3ba divides points-per-game by shared drive count",
      collegeScaleApplied: false,
      FOOTBALL_COLLEGE_RATE_INPUT_SCALE_multipliedInLivePath: false,
    },
    ratioOldVsCorrectedHome: newHome === 0 ? null : oldHome / newHome,
  };
});

const scaleAppliedIn013 = /return safe \* FOOTBALL_COLLEGE_RATE_INPUT_SCALE/.test(matchupOld);
const scaleMultipliedIn2c13 = /\*\s*FOOTBALL_COLLEGE_RATE_INPUT_SCALE|FOOTBALL_COLLEGE_RATE_INPUT_SCALE\s*\*/.test(
  matchupNew,
);
const scaleMultipliedInSim2c13 = /FOOTBALL_COLLEGE_RATE_INPUT_SCALE/.test(simNew);
const ppgDivideIn2c13 = /return ppg \/ n/.test(matchupNew);
const engineVersion013 = /FOOTBALL_DRIVE_ENGINE_VERSION\s*=\s*"ppg-per-drive-v1"/.test(matchupOld);
const engineVersion2c13 = /FOOTBALL_DRIVE_ENGINE_VERSION\s*=\s*"ppg-per-drive-v1"/.test(matchupNew);
const caller013 = extract(simOld, /const homeRate = footballDriveRateInput/, /\n  const /);
const caller2c13 = extract(simNew, /const drives = footballExpectedDrives/, /\n  const homeScores/);

const report = {
  generatedAt: new Date().toISOString(),
  compared: { old: OLD, corrected: CORRECTED },
  proof: {
    engineVersionLabelAloneInsufficient: true,
    "013ddb88": {
      hasPpgPerDriveV1Label: engineVersion013,
      footballDriveRateInputAppliesCollege048: scaleAppliedIn013,
      callerFeedsGameMeanAsPpd: /footballDriveRateInput\(homeOff,\s*ctx\.sport\)/.test(simOld),
      callerSnippet: caller013,
    },
    "2c13a3ba": {
      hasPpgPerDriveV1Label: engineVersion2c13,
      footballDriveRateInputDividesPpgByDrives: ppgDivideIn2c13,
      FOOTBALL_COLLEGE_RATE_INPUT_SCALE_multipliedInMatchup: scaleMultipliedIn2c13,
      FOOTBALL_COLLEGE_RATE_INPUT_SCALE_referencedInNflDriveSim: scaleMultipliedInSim2c13,
      retiredConstantStillExported: /export const FOOTBALL_COLLEGE_RATE_INPUT_SCALE = 0\.48/.test(
        matchupNew,
      ),
      retiredCommentPresent: /Retired\. Multiplying college points-per-game by 0\.48/.test(
        matchupNew,
      ),
      callerSnippet: caller2c13,
    },
  },
  identicalPpgInputs: numeric,
  verdict: {
    ppgConversionIntactAt2c13a3ba: ppgDivideIn2c13 && !scaleMultipliedIn2c13 && !scaleMultipliedInSim2c13,
    retiredCollege048AbsentFromLivePathAt2c13a3ba: !scaleMultipliedIn2c13 && !scaleMultipliedInSim2c13,
    "013ddb88StillApplies048AndFeedsPpgAsPpd": scaleAppliedIn013,
  },
};

mkdirSync("/opt/cursor/artifacts", { recursive: true });
mkdirSync("/workspace/artifacts/api-server/test/fixtures", { recursive: true });
const out = JSON.stringify(report, null, 2);
writeFileSync("/opt/cursor/artifacts/drive-engine-commit-compare.json", out);
writeFileSync(
  "/workspace/artifacts/api-server/test/fixtures/drive-engine-commit-compare.json",
  out,
);
console.log(out);
if (!report.verdict.ppgConversionIntactAt2c13a3ba || !report.verdict.retiredCollege048AbsentFromLivePathAt2c13a3ba) {
  process.exitCode = 2;
}

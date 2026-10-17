/**
 * Freeze A0 — decompose margin location error vs uncertainty calibration.
 * Research-only. Does not retune params. FINAL_EVAL untouched.
 * Protocol companion: docs/coach/ncaaf-clean-a0-next-experiment.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CleanOppAdjStrength,
  NCAAF_CLEAN_ENGINE_STAMP,
  buildPregameFromFixtureRow,
  pHomeCoverFromMargin,
  pHomeMlFromMargin,
  predictScoreMargin,
  settleAtsHome,
  settleMoneyline,
  type CleanFixtureGameRow,
} from "../src/lib/sportSim/ncaafClean/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");

type CloseRow = {
  gameId: string;
  closeMlHome?: number | null;
  closeSpreadHome?: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
  injuryKnown?: boolean | null;
  qbOut?: boolean | null;
};

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function rmse(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.sqrt(mean(xs.map((x) => x * x))!);
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))!);
}

/** Bootstrap SE of a scalar summary (resample with replacement). */
function bootstrapSe(
  xs: number[],
  stat: (sample: number[]) => number | null,
  B = 400,
): number | null {
  if (xs.length < 5) return null;
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      sample.push(xs[Math.floor(Math.random() * xs.length)]!);
    }
    const v = stat(sample);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  return stdev(vals);
}

function seMean(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const s = stdev(xs);
  if (s == null) return null;
  return s / Math.sqrt(xs.length);
}

type Row = {
  eventId: string;
  week: number;
  absSpread: number;
  marginMean: number;
  marginSd: number;
  uncertainty: number;
  actMargin: number;
  residual: number;
  z: number;
  absZ: number;
  nHome: number;
  nAway: number;
  minN: number;
  pMl: number;
  pMkt: number;
  yMl: number;
  pAts: number | null;
  yAts: number | null;
  largeGt14: boolean;
  mismatch: boolean;
};

function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

const finish = loadJson<{
  exclusions: Array<{ eventId: string; reason: string }>;
}>("ncaaf-tuning-identical-334-finish.json");
const tuningDoc = loadJson<{ games: CleanFixtureGameRow[] }>(
  "ncaaf-tuning-2025-w1-7-games.json",
);
const phaseEDoc = loadJson<{ games?: CleanFixtureGameRow[] } | CleanFixtureGameRow[]>(
  "ncaaf-phase-e-games.json",
);
const phaseE = Array.isArray(phaseEDoc)
  ? phaseEDoc
  : (phaseEDoc.games as CleanFixtureGameRow[]);
const closesArr = loadJson<{ games: CloseRow[] }>(
  "ncaaf-tuning-2025-w1-7-closing-lines.json",
).games;
const closes = new Map(closesArr.map((c) => [String(c.gameId), c]));
const tags = new Map(
  loadJson<{ games: Array<{ eventId: string; matchupSubdivision: string }> }>(
    "ncaaf-tuning-2025-w1-7-games.subdivision-tags.json",
  ).games.map((g) => [String(g.eventId), g.matchupSubdivision]),
);
const unrated = new Set(
  finish.exclusions.filter((e) => e.reason === "unrated_fbs_side").map((e) => e.eventId),
);
const identicalIds = new Set(
  [...closes.keys()].filter((eid) => {
    const c = closes.get(eid)!;
    if (c.closeMlHome == null || c.closeSpreadHome == null) return false;
    if (tags.get(eid) !== "fbs_fbs") return false;
    if (unrated.has(eid)) return false;
    if (c.homeScore != null && c.awayScore != null && c.homeScore === c.awayScore) {
      return false;
    }
    return true;
  }),
);

// Injury/QB coverage on closes archive
let injuryNonNull = 0;
let qbNonNull = 0;
for (const c of closesArr) {
  if (c.injuryKnown != null) injuryNonNull++;
  if (c.qbOut != null) qbNonNull++;
}

const strength = new CleanOppAdjStrength({ season: 2025 });
strength.seedFromPriorSeason(
  phaseE
    .filter((g) => g.season === 2024 && g.homeFg != null && g.awayFg != null)
    .map((g) => ({
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeFg: g.homeFg!,
      awayFg: g.awayFg!,
      season: g.season,
      kickoffIso: g.kickoffIso,
    })),
);

const rows: Row[] = [];
const games = [...tuningDoc.games].sort((a, b) =>
  String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
);

for (const g of games) {
  const pre = buildPregameFromFixtureRow(g, { useVenueSidecar: true });
  const close = closes.get(String(g.eventId));
  const nHome = strength.getSeasonN(g.homeTeamId);
  const nAway = strength.getSeasonN(g.awayTeamId);
  const pred = predictScoreMargin({ pregame: pre, strength });

  if (
    pred.ok &&
    pred.evaluableSupported &&
    identicalIds.has(String(g.eventId)) &&
    close?.closeMlHome != null &&
    close.closeSpreadHome != null &&
    g.homeFg != null &&
    g.awayFg != null
  ) {
    const ml = settleMoneyline({
      homeScore: g.homeFg,
      awayScore: g.awayFg,
      decided: true,
    });
    if (ml.ok) {
      const actMargin = g.homeFg - g.awayFg;
      const residual = actMargin - pred.marginMean;
      const z = residual / Math.max(1e-6, pred.marginSd);
      const ats = settleAtsHome({
        homeScore: g.homeFg,
        awayScore: g.awayFg,
        homeSpreadLine: close.closeSpreadHome,
        decided: true,
      });
      const absSpread = Math.abs(close.closeSpreadHome);
      const mismatch =
        Math.sign(pred.marginMean || 1e-9) !== Math.sign(actMargin || 1e-9) &&
        Math.abs(actMargin - pred.marginMean) >= 14;
      rows.push({
        eventId: String(g.eventId),
        week: g.week ?? 0,
        absSpread,
        marginMean: pred.marginMean,
        marginSd: pred.marginSd,
        uncertainty: pred.uncertainty,
        actMargin,
        residual,
        z,
        absZ: Math.abs(z),
        nHome,
        nAway,
        minN: Math.min(nHome, nAway),
        pMl: pHomeMlFromMargin(pred.marginMean, pred.marginSd),
        pMkt: americanToImplied(close.closeMlHome),
        yMl: ml.yHomeWin,
        pAts: pHomeCoverFromMargin(
          pred.marginMean,
          pred.marginSd,
          close.closeSpreadHome,
        ),
        yAts: ats.ok ? ats.yHomeCover : null,
        largeGt14: absSpread > 14,
        mismatch,
      });
    }
  }

  if (g.homeFg != null && g.awayFg != null) {
    strength.update({
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeFg: g.homeFg,
      awayFg: g.awayFg,
      season: g.season,
      kickoffIso: g.kickoffIso,
    });
  }
}

function sliceSummary(label: string, xs: Row[]) {
  const resid = xs.map((r) => r.residual);
  const absZ = xs.map((r) => r.absZ);
  const z = xs.map((r) => r.z);
  const sds = xs.map((r) => r.marginSd);
  const unc = xs.map((r) => r.uncertainty);
  const predAbs = xs.map((r) => Math.abs(r.marginMean));
  const actAbs = xs.map((r) => Math.abs(r.actMargin));
  const gapPredVsMkt = xs.map((r) => Math.abs(r.marginMean) - r.absSpread);
  // Location: signed residual + understatement of |margin| vs market line magnitude
  const meanRes = mean(resid);
  const rmseRes = rmse(resid);
  const meanAbsZ = mean(absZ);
  const meanSd = mean(sds);
  const fracAbsZgt2 = xs.filter((r) => r.absZ > 2).length / Math.max(1, xs.length);
  const fracAbsZlt1 = xs.filter((r) => r.absZ < 1).length / Math.max(1, xs.length);
  // If calibrated, E[|Z|]≈0.798 for half-normal; E[Z^2]≈1; RMSE≈mean σ
  const meanZ2 = mean(xs.map((r) => r.z * r.z));
  return {
    label,
    n: xs.length,
    location: {
      meanResidual: meanRes,
      meanResidualSe: seMean(resid),
      meanResidualBootSe: bootstrapSe(resid, mean),
      rmseResidual: rmseRes,
      rmseResidualBootSe: bootstrapSe(resid, rmse),
      meanAbsPredMargin: mean(predAbs),
      meanAbsActMargin: mean(actAbs),
      meanAbsSpread: mean(xs.map((r) => r.absSpread)),
      meanPredAbsMinusSpread: mean(gapPredVsMkt),
      meanPredAbsMinusSpreadSe: seMean(gapPredVsMkt),
    },
    uncertainty: {
      meanMarginSd: meanSd,
      meanUncertainty: mean(unc),
      meanAbsZ,
      meanAbsZSe: seMean(absZ),
      meanAbsZBootSe: bootstrapSe(absZ, mean),
      meanZ: mean(z),
      meanZ2,
      meanZ2Se: seMean(xs.map((r) => r.z * r.z)),
      /** ~1 if σ matches residual scale; >1 ⇒ σ too small; <1 ⇒ σ too large */
      rmseOverMeanSd:
        rmseRes != null && meanSd != null && meanSd > 0 ? rmseRes / meanSd : null,
      fracAbsZgt2,
      fracAbsZlt1,
      expectedAbsZHalfNormal: 0.7979,
      expectedZ2: 1.0,
    },
    nMismatch14: xs.filter((r) => r.mismatch).length,
  };
}

const all = sliceSummary("identical_334", rows);
const w1 = sliceSummary(
  "week1",
  rows.filter((r) => r.week === 1),
);
const large = sliceSummary(
  "large_abs_gt14",
  rows.filter((r) => r.largeGt14),
);
const mismatch = sliceSummary(
  "sign_flip_abs_resid_ge14",
  rows.filter((r) => r.mismatch),
);
const w1Large = sliceSummary(
  "week1_and_large_gt14",
  rows.filter((r) => r.week === 1 && r.largeGt14),
);

// Seed quality probe: W1 only — correlate pred margin with act; vs close line
function corr(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ma = mean(a)!;
  const mb = mean(b)!;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da <= 0 || db <= 0) return null;
  return num / Math.sqrt(da * db);
}

const w1rows = rows.filter((r) => r.week === 1);
const largeRows = rows.filter((r) => r.largeGt14);

const priorDiagnostics = {
  week1: {
    n: w1rows.length,
    corrPredAct: corr(
      w1rows.map((r) => r.marginMean),
      w1rows.map((r) => r.actMargin),
    ),
    corrPredAbsSpread: corr(
      w1rows.map((r) => Math.abs(r.marginMean)),
      w1rows.map((r) => r.absSpread),
    ),
    meanMinN: mean(w1rows.map((r) => r.minN)),
    note: "W1 minN is 0 by design (seasonN not incremented by seed)",
  },
  largeGt14: {
    n: largeRows.length,
    corrPredAct: corr(
      largeRows.map((r) => r.marginMean),
      largeRows.map((r) => r.actMargin),
    ),
    corrPredAbsSpread: corr(
      largeRows.map((r) => Math.abs(r.marginMean)),
      largeRows.map((r) => r.absSpread),
    ),
    meanAbsPred: mean(largeRows.map((r) => Math.abs(r.marginMean))),
    meanAbsAct: mean(largeRows.map((r) => Math.abs(r.actMargin))),
    meanAbsSpread: mean(largeRows.map((r) => r.absSpread)),
    /** Systematic gap compression vs close line */
    meanCompressionVsLine: mean(
      largeRows.map((r) => r.absSpread - Math.abs(r.marginMean)),
    ),
    meanCompressionVsLineSe: seMean(
      largeRows.map((r) => r.absSpread - Math.abs(r.marginMean)),
    ),
  },
};

// Phase-e 2024 seed coverage
const phaseE2024 = phaseE.filter(
  (g) => g.season === 2024 && g.homeFg != null && g.awayFg != null,
);
const dataSupport = {
  opponentAdjustedEfficiency: {
    scoreBasedOppAdjPpg: {
      supported: true,
      alreadyInA0: true,
      source: "CleanOppAdjStrength on phase-e 2024 FBS–FBS finals + in-season updates",
      nPriorSeasonGamesInFixtures: phaseE2024.length,
      note: "A0 already uses score/PPG opponent-adjusted offense/defense — not yards/EPA/success-rate.",
    },
    advancedEfficiencyEpaOrSuccessRate: {
      supported: false,
      inTuningFixtures: false,
      inPhaseEFixtures: false,
      note: "No play-by-play / EPA / success-rate fields on TUNING or phase-e game rows. Cannot evaluate advanced efficiency without new free ESPN drive cache (out of scope for this freeze).",
    },
  },
  rosterQbContinuity: {
    historicalPregameOnTuningCloses: {
      supported: false,
      closesRows: closesArr.length,
      injuryKnownNonNull: injuryNonNull,
      qbOutNonNull: qbNonNull,
      note: "injuryKnown/qbOut are 100% null on TUNING closes archive. Game fixtures lack roster/depth/starter fields.",
    },
    e4Status: "OPEN — forward ESPN collector only; no historical backfill authorized",
    canEvaluateOnTimeOrderedTuningNow: false,
  },
};

const ablationRound = {
  status: "CLOSED",
  frozenCandidate: "A0_full",
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  ablationsNotAdopted: ["A1_no_hfa", "A2_fixed_sigma", "A3_no_prior_seed"],
  reason:
    "A1/A3 worse; A2 improved ML Δ but worsened ATS — protocol forbids threshold shopping. Freeze A0 means.",
  finalEval: "NOT_ADVANCED",
};

const proposedExperiment = {
  id: "E1_prior_gap_scale_w1_large",
  title: "Prior talent-gap scale (location-only) on seed-driven margins",
  status: "PROPOSAL_ONLY — do not implement until approved",
  hypothesis:
    "A0 large-favorite and Week-1 errors are dominated by margin LOCATION compression (predicted |margin| << close |spread| and actual |margin|), not by σ miscalibration. Scaling the prior-seeded offense/defense gap (before HFA) by a single predeclared factor α∈{1.15,1.25} should reduce mean residual bias and |pred|−|spread| compression on W1 and abs>14 without changing cleanUncertainty / marginSd formulas.",
  whyNotUncertaintyRetune:
    "Decomposition shows meanAbsZ ≲ expected (~0.80) and RMSE/meanSd ≲ 1 on W1/large — σ is if anything slightly wide. A2 already tested σ=base; adopting it would be threshold shopping on ML.",
  whyNotOppAdjEpaOrQb:
    "Advanced efficiency and historical QB/roster continuity are NOT supported by existing TUNING/phase-e archives (see dataSupport). Do not invent them.",
  requiredInputs: {
    alreadyPresent: [
      "phase-e 2024 FBS–FBS finals (seed)",
      "TUNING 2025 w1–7 games + venue sidecar",
      "identical-334 closes (eval-only)",
      "frozen A0 HFA / LR / base σ / uncertainty formula",
    ],
    forbidden: [
      "close prices as features",
      "paid Odds/injury backfill",
      "QB/roster imputation",
      "FINAL_EVAL build",
      "changing NCAAF gate / OTA / deploy",
    ],
    newDataNeeded: "none",
  },
  protocol: {
    freezeBaseline: "A0_full exactly as locked",
    lever:
      "Single scalar α applied only to (homeOff−awayOff) component from ratings after seed/update; HFA added after scale; uncertainty path unchanged",
    predeclaredGrid: [1.15, 1.25],
    selectionRule:
      "On time-ordered TUNING folds, pick α only if BOTH (a) identical-334 overall ML Δ and ATS Brier do not worsen vs A0 beyond bootstrap SE, AND (b) W1 meanResidual bias and large>14 meanCompressionVsLine improve by ≥1 SE. If neither α clears, KEEP A0 — no further grid.",
    evaluation: [
      "Walk chronologically (same as A0)",
      "Score week k after causal updates from weeks < k",
      "Report W1, large abs>14, overall identical-334",
      "Report meanResidual±SE, RMSE±bootSE, meanAbsZ±SE, rmse/meanSd, ML Δ±bootSE, ATS Brier±bootSE",
    ],
    stopConditions: [
      "Do not expand α grid after seeing scores",
      "Do not adopt if only ML improves and ATS worsens (A2 lesson)",
      "Do not advance to FINAL_EVAL from this screen alone",
    ],
  },
};

const report = {
  generatedAt: new Date().toISOString(),
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  ablationRound,
  ops: {
    ncaafGate: false,
    injuryValidation: "OPEN",
    productionFreeze: true,
    voice: "paused",
    paidRetrieval: false,
    deployOta: false,
    finalEval: "UNTOUCHED",
  },
  identicalN: rows.length,
  decomposition: { all, w1, large, mismatch, w1Large },
  priorDiagnostics,
  dataSupport,
  proposedExperiment,
  readingGuide: {
    locationProblem:
      "Positive meanResidual ⇒ understated home margin. meanCompressionVsLine>0 ⇒ |pred margin| smaller than close |spread|.",
    uncertaintyProblem:
      "meanZ2>1 or RMSE/meanSd>1 ⇒ σ too small; meanAbsZ<<0.80 and RMSE/meanSd<1 ⇒ σ too large / over-diffuse.",
  },
};

writeFileSync(
  join(FIX, "ncaaf-clean-a0-error-decomposition.json"),
  JSON.stringify(report, null, 2) + "\n",
);

function fmt(x: number | null | undefined, d = 3): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(d);
}

function locBlock(s: ReturnType<typeof sliceSummary>): string {
  const L = s.location;
  const U = s.uncertainty;
  return `| ${s.label} | ${s.n} | ${fmt(L.meanResidual)}±${fmt(L.meanResidualSe, 2)} | ${fmt(L.rmseResidual)}±${fmt(L.rmseResidualBootSe, 2)} | ${fmt(L.meanPredAbsMinusSpread)}±${fmt(L.meanPredAbsMinusSpreadSe, 2)} | ${fmt(U.meanMarginSd, 2)} | ${fmt(U.meanAbsZ, 2)}±${fmt(U.meanAbsZSe, 2)} | ${fmt(U.meanZ2, 2)} | ${fmt(U.rmseOverMeanSd, 2)} | ${s.nMismatch14} |`;
}

const md = `# A0 freeze — margin vs uncertainty decomposition + next experiment

**Stamp:** \`${NCAAF_CLEAN_ENGINE_STAMP}\`  
**Generated:** ${report.generatedAt}  
**Ablation round:** **CLOSED** — frozen candidate **A0_full** (A1/A2/A3 not adopted). **FINAL_EVAL not advanced.**  
**Ops:** NCAAF gate false · injury validation OPEN · production freeze · voice paused · no spend/deploy/OTA

## 1. Ablation round closed

| Item | Decision |
|------|----------|
| Freeze | \`A0_full\` (venue HFA + uncertainty σ + score opp-adj + 2024 seed) |
| Rejected | A1 no-HFA, A2 fixed-σ (ML↑ ATS↓ shopping), A3 no-seed |
| FINAL_EVAL | **Not started** |

## 2. Error decomposition (identical-334 A0)

Residual = \`(home−away) − marginMean\`. Uncertainty diagnostics use \`Z = residual / marginSd\` (expected \|Z\|≈0.80, E[Z²]≈1 if calibrated).

| Slice | n | mean resid ± SE | RMSE ± bootSE | \|pred\|−\|spread\| ± SE | mean σ | mean\|Z\| ± SE | mean Z² | RMSE/σ | n mismatch≥14 |
|-------|--:|----------------:|--------------:|-------------------------:|-------:|---------------:|--------:|-------:|--------------:|
${locBlock(all)}
${locBlock(w1)}
${locBlock(large)}
${locBlock(w1Large)}
${locBlock(mismatch)}

### Reading

- **Location:** Overall / W1 / large all show **positive** mean residual (home margin understated). Large favorites: predicted \|margin\| compressed vs close line (\`meanCompressionVsLine\` in JSON priorDiagnostics).
- **Uncertainty:** mean\|Z\| and RMSE/σ are **≤** half-normal / 1.0 on these slices ⇒ σ is **not too tight**; A2’s fixed-σ ML gain was not a calibration fix to adopt in isolation.
- **Implication:** Next lever should target **prior/gap location** on W1 + large mismatches, not another σ knob.

## 3. Data support assessment

| Candidate input | Supported by existing archives? | Notes |
|-----------------|----------------------------------|-------|
| Opponent-adjusted **score/PPG** efficiency | **Yes — already in A0** | \`CleanOppAdjStrength\` + phase-e 2024 seed (n=${phaseE2024.length} games) |
| Opponent-adjusted **EPA / success-rate** | **No** | Not on TUNING/phase-e rows |
| Roster / QB continuity (historical pregame) | **No** | \`injuryKnown\`/\`qbOut\` non-null on closes: ${injuryNonNull}/${closesArr.length} / ${qbNonNull}/${closesArr.length}; E4 open; no TUNING roster fields |
| Forward ESPN injury/QB collector | Forward-only | Cannot re-score 2025 TUNING historically without inventing |

## 4. Proposed bounded experiment (PROPOSAL ONLY — do not implement yet)

### E1 — Prior talent-gap scale (location-only)

| Field | Content |
|-------|---------|
| **Hypothesis** | W1 / large-fav errors are mostly **margin compression** from the 2024 seed + opp-adj PPG ratings, not σ. Scaling the rating gap by a predeclared α∈{1.15, 1.25} (HFA after; uncertainty formula frozen) reduces location bias without ATS regression. |
| **Required inputs** | Existing phase-e 2024 + TUNING + venue sidecar + identical-334 closes (eval-only). **No new data. No QB/EPA.** |
| **Evaluation** | Time-ordered TUNING week folds vs frozen A0; report meanResidual±SE, RMSE±bootSE, mean\|Z\|±SE, ML Δ±bootSE, ATS Brier±bootSE on overall / W1 / abs>14. |
| **Selection** | Adopt α only if location improves ≥1 SE on W1 **and** large **and** overall ML/ATS do not worsen beyond SE; else keep A0. **No grid expansion after scores. No FINAL_EVAL.** |
| **Explicit non-goals** | No σ retune; no close features; no spend; no gate/OTA/deploy; no injury backfill |

## 5. Uncertainty on metrics

All primary location/σ summaries above include **analytic SE** (mean) and/or **bootstrap SE** (RMSE, Brier when scored in E1). Slice n≈47 (W1) and n≈94 (large) remain thin — treat M3/S2 flags as descriptive only.

Fixture: \`artifacts/api-server/test/fixtures/ncaaf-clean-a0-error-decomposition.json\`
`;

writeFileSync(join(FIX, "ncaaf-clean-a0-error-decomposition.md"), md);
writeFileSync(join(DOCS, "ncaaf-clean-a0-error-decomposition.md"), md);
writeFileSync(join(DOCS, "ncaaf-clean-a0-next-experiment.md"), md);

console.log(
  JSON.stringify(
    {
      ablationRound,
      identicalN: rows.length,
      all: all.location,
      allUnc: all.uncertainty,
      w1: w1.location,
      w1Unc: w1.uncertainty,
      large: large.location,
      largeUnc: large.uncertainty,
      priorDiagnostics,
      dataSupportSummary: {
        scoreOppAdj: true,
        epa: false,
        qbHistorical: false,
        injuryNonNull,
        qbNonNull,
      },
      proposedExperimentId: proposedExperiment.id,
    },
    null,
    2,
  ),
);

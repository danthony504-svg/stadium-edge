/**
 * E1 α=1.15 frozen candidate — ATS error diagnosis + ML readiness blockers.
 * Research-only. No threshold edits. No margin-scale sweep. FINAL_EVAL untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLEAN_HFA_POINTS,
  CleanOppAdjStrength,
  NCAAF_CLEAN_ENGINE_STAMP,
  buildPregameFromFixtureRow,
  cleanMarginSd,
  cleanUncertainty,
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

/** Frozen E1 research candidate — no further α sweeps. */
const ALPHA = 1.15;

type CloseRow = {
  gameId: string;
  closeMlHome?: number | null;
  closeSpreadHome?: number | null;
};

type Row = {
  eventId: string;
  week: number;
  absSpread: number;
  marginMean: number;
  marginSd: number;
  actMargin: number;
  residual: number;
  /** Predicted cover margin: marginMean - (-line) = marginMean + line */
  predCoverMargin: number;
  /** Actual cover margin: actMargin + line */
  actCoverMargin: number;
  coverResidual: number; // actCoverMargin - predCoverMargin (== residual)
  pAts: number;
  yAts: number | null;
  pMl: number;
  pMkt: number;
  yMl: number;
  largeGt14: boolean;
};

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))!);
}

function seMean(xs: number[]): number | null {
  const s = sd(xs);
  if (s == null) return null;
  return s / Math.sqrt(xs.length);
}

function brier(ps: number[], ys: number[]): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function rmse(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.sqrt(mean(xs.map((x) => x * x))!);
}

function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

/** Normal CDF approx (same spirit as settlement). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

function pCoverFromMuSd(mu: number, sdV: number, line: number): number {
  const s = Math.max(1e-6, sdV);
  const z = (-line - mu) / s;
  return Math.max(0.02, Math.min(0.98, 1 - normalCdf(z)));
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

function predictE1(
  pregame: ReturnType<typeof buildPregameFromFixtureRow>,
  strength: CleanOppAdjStrength,
): {
  marginMean: number;
  marginSd: number;
  evaluableSupported: boolean;
} | null {
  const base = predictScoreMargin({ pregame, strength });
  if (!base.ok) return null;
  const hfaPoints = pregame.venue.kind === "home" ? CLEAN_HFA_POINTS : 0;
  const pts0 = strength.expectedPoints(
    pregame.home.teamId,
    pregame.away.teamId,
    0,
  );
  const marginMean = ALPHA * pts0.marginMean + hfaPoints;
  const uncertainty = cleanUncertainty({
    week: pregame.week ?? 99,
    nHomeFbsGames: strength.getSeasonN(pregame.home.teamId),
    nAwayFbsGames: strength.getSeasonN(pregame.away.teamId),
  });
  return {
    marginMean,
    marginSd: cleanMarginSd(uncertainty),
    evaluableSupported: base.evaluableSupported,
  };
}

function walk(): Row[] {
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
  const out: Row[] = [];
  const games = [...tuningDoc.games].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );
  for (const g of games) {
    const pre = buildPregameFromFixtureRow(g, { useVenueSidecar: true });
    const close = closes.get(String(g.eventId));
    const pred = predictE1(pre, strength);
    if (
      pred &&
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
        const line = close.closeSpreadHome;
        const actMargin = g.homeFg - g.awayFg;
        const residual = actMargin - pred.marginMean;
        const predCoverMargin = pred.marginMean + line;
        const actCoverMargin = actMargin + line;
        const ats = settleAtsHome({
          homeScore: g.homeFg,
          awayScore: g.awayFg,
          homeSpreadLine: line,
          decided: true,
        });
        out.push({
          eventId: String(g.eventId),
          week: g.week ?? 0,
          absSpread: Math.abs(line),
          marginMean: pred.marginMean,
          marginSd: pred.marginSd,
          actMargin,
          residual,
          predCoverMargin,
          actCoverMargin,
          coverResidual: actCoverMargin - predCoverMargin,
          pAts: pHomeCoverFromMargin(pred.marginMean, pred.marginSd, line),
          yAts: ats.ok ? ats.yHomeCover : null,
          pMl: pHomeMlFromMargin(pred.marginMean, pred.marginSd),
          pMkt: americanToImplied(close.closeMlHome),
          yMl: ml.yHomeWin,
          largeGt14: Math.abs(line) > 14,
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
  return out;
}

const rows = walk();
const atsRows = rows.filter((r) => r.yAts != null);

/** Calibration bins by predicted cover probability. */
function calibBins(xs: Row[], edges: number[]) {
  const bins: Array<{
    lo: number;
    hi: number;
    n: number;
    meanP: number | null;
    meanY: number | null;
    gap: number | null;
    brier: number | null;
  }> = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = xs.filter(
      (r) => r.yAts != null && r.pAts >= lo && (i === edges.length - 2 ? r.pAts <= hi : r.pAts < hi),
    );
    const ps = inBin.map((r) => r.pAts);
    const ys = inBin.map((r) => r.yAts!);
    const mp = mean(ps);
    const my = mean(ys);
    bins.push({
      lo,
      hi,
      n: inBin.length,
      meanP: mp,
      meanY: my,
      gap: mp != null && my != null ? mp - my : null,
      brier: brier(ps, ys),
    });
  }
  return bins;
}

const edges = [0.02, 0.2, 0.35, 0.5, 0.65, 0.8, 0.98];
const calibAll = calibBins(atsRows, edges);
const calibW1 = calibBins(
  atsRows.filter((r) => r.week === 1),
  edges,
);
const calibLarge = calibBins(
  atsRows.filter((r) => r.largeGt14),
  edges,
);

function foldSummary(label: string, xs: Row[]) {
  const ats = xs.filter((r) => r.yAts != null);
  const resid = xs.map((r) => r.residual);
  const coverRes = ats.map((r) => r.coverResidual);
  const zCover = ats.map(
    (r) => r.coverResidual / Math.max(1e-6, r.marginSd),
  );
  const atsB = brier(
    ats.map((r) => r.pAts),
    ats.map((r) => r.yAts!),
  );
  const mlB = brier(
    xs.map((r) => r.pMl),
    xs.map((r) => r.yMl),
  );
  const mkB = brier(
    xs.map((r) => r.pMkt),
    xs.map((r) => r.yMl),
  );
  // Location: mean cover residual (should be ~0 if means calibrated to line)
  // Shape proxy: ATS Brier after oracle location correction (shift μ by mean residual)
  const meanRes = mean(resid);
  let atsBrierLocationCorrected: number | null = null;
  if (meanRes != null && ats.length) {
    const ps: number[] = [];
    const ys: number[] = [];
    for (const r of ats) {
      // Reconstruct line from predCoverMargin = marginMean + line
      const line = r.predCoverMargin - r.marginMean;
      const muCorr = r.marginMean + meanRes; // add overall slice mean residual
      ps.push(pCoverFromMuSd(muCorr, r.marginSd, line));
      ys.push(r.yAts!);
    }
    atsBrierLocationCorrected = brier(ps, ys);
  }
  return {
    label,
    nMl: xs.length,
    nAts: ats.length,
    meanResidual: meanRes,
    meanResidualSe: seMean(resid),
    meanCoverResidual: mean(coverRes),
    meanCoverResidualSe: seMean(coverRes),
    rmseResidual: rmse(resid),
    meanAbsZCover: mean(zCover.map(Math.abs)),
    meanZ2Cover: mean(zCover.map((z) => z * z)),
    atsBrier: atsB,
    atsBrierLocationCorrected,
    /** If location-corrected Brier ≪ raw ⇒ location dominates; if similar ⇒ shape/σ */
    locationShareOfAtsError:
      atsB != null && atsBrierLocationCorrected != null
        ? atsB - atsBrierLocationCorrected
        : null,
    mlBrier: mlB,
    mktBrier: mkB,
    deltaVsMarket: mlB != null && mkB != null ? mlB - mkB : null,
    meanPAts: mean(ats.map((r) => r.pAts)),
    meanYAts: mean(ats.map((r) => r.yAts!)),
    atsBias: (() => {
      const mp = mean(ats.map((r) => r.pAts));
      const my = mean(ats.map((r) => r.yAts!));
      return mp != null && my != null ? mp - my : null;
    })(),
  };
}

const overall = foldSummary("identical_334", rows);
const weekFolds = [1, 2, 3, 4, 5, 6, 7].map((w) =>
  foldSummary(`W${w}`, rows.filter((r) => r.week === w)),
);
const large = foldSummary(
  "large_gt14",
  rows.filter((r) => r.largeGt14),
);

// Reliability slope: regress y on p (simple)
function reliabilitySlope(xs: Row[]): {
  n: number;
  slope: number | null;
  intercept: number | null;
} {
  const ats = xs.filter((r) => r.yAts != null);
  const n = ats.length;
  if (n < 10) return { n, slope: null, intercept: null };
  const ps = ats.map((r) => r.pAts);
  const ys = ats.map((r) => r.yAts!);
  const mp = mean(ps)!;
  const my = mean(ys)!;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (ps[i]! - mp) * (ys[i]! - my);
    den += (ps[i]! - mp) ** 2;
  }
  if (den <= 0) return { n, slope: null, intercept: null };
  const slope = num / den;
  const intercept = my - slope * mp;
  return { n, slope, intercept };
}

const relAll = reliabilitySlope(rows);
const relW1 = reliabilitySlope(rows.filter((r) => r.week === 1));
const relLarge = reliabilitySlope(rows.filter((r) => r.largeGt14));

/**
 * Evidence for next experiment:
 * - If locationShare large and shape residual small → would suggest more location work,
 *   but margin-scale sweeps STOPPED — do not propose another α.
 * - If location-corrected ATS still fails coin and calib gaps remain in mid bins →
 *   shape/σ experiment may be warranted.
 * - If evidence mixed/thin → propose NONE.
 */
const locationShare = overall.locationShareOfAtsError;
const atsAfterLoc = overall.atsBrierLocationCorrected;
const shapeStillFailsCoin =
  atsAfterLoc != null ? atsAfterLoc >= 0.25 : null;
const midBinGaps = calibAll
  .filter((b) => b.n >= 20 && b.gap != null)
  .map((b) => ({ ...b, absGap: Math.abs(b.gap!) }));

const maxMidGap = midBinGaps.length
  ? midBinGaps.reduce((a, b) => (b.absGap > a.absGap ? b : a))
  : null;

let proposedExperiment: {
  id: string;
  status: string;
  hypothesis?: string;
  rationale: string;
  requiredInputs?: string[];
  evaluation?: string;
} | null = null;

// ML readiness vs locked requirements (report only; thresholds unchanged)
const mlB = overall.mlBrier!;
const mkB = overall.mktBrier!;
const meanP = mean(rows.map((r) => r.pMl));
const meanY = mean(rows.map((r) => r.yMl));
const mlBias = meanP != null && meanY != null ? meanP - meanY : null;

const clvReport = loadJson<{
  verdict?: string;
  nMlWithClv?: number;
  meanClvProbPoints?: number;
  pctSelectionsBeatClose?: number;
  earlyCachePicks?: number;
}>("ncaaf-phase-e-coach-pick-clv-report.json");

const injuryNonNull = closesArr.filter(
  (c) => (c as { injuryKnown?: unknown }).injuryKnown != null,
).length;
const qbNonNull = closesArr.filter(
  (c) => (c as { qbOut?: unknown }).qbOut != null,
).length;

const mlReadiness = {
  note: "Independent assessment against locked criteria. TUNING M3 screen ≠ FINAL_EVAL authorization.",
  thresholdsUnchanged: true,
  finalEvalUntouched: true,
  criteria: {
    M1_sample: {
      requirement: "n ≥ 200 decided with close ML (FINAL_EVAL)",
      tuningScreen_n: rows.length,
      tuningScreen_ok: rows.length >= 200,
      finalEval: "NOT_BUILT",
      blocker: "FINAL_EVAL fixtures empty — cannot claim M1 on reserved set",
    },
    M2_vs_coin: {
      requirement: "brierEngine < 0.25",
      tuningScreen_brier: mlB,
      tuningScreen_ok: mlB < 0.25,
      finalEval: "NOT_SCORED",
      blocker: "FINAL_EVAL unscored",
    },
    M3_vs_market: {
      requirement: "brierEngine ≤ brierMarket + 0.02",
      tuningScreen_delta: mlB - mkB,
      tuningScreen_ok: mlB <= mkB + 0.02,
      note: "E1 α=1.15 TUNING identical-334 screen only — does NOT authorize FINAL_EVAL",
      finalEval: "NOT_SCORED",
      blocker: "TUNING M3 pass is screening only; FINAL_EVAL required for acceptance",
    },
    M4_bias: {
      requirement: "|meanP − meanY| ≤ 0.08",
      tuningScreen_bias: mlBias,
      tuningScreen_ok: mlBias != null ? Math.abs(mlBias) <= 0.08 : false,
      finalEval: "NOT_SCORED",
    },
    S2_ats: {
      requirement: "ATS brier < 0.25 vs coin",
      tuningScreen_brier: overall.atsBrier,
      tuningScreen_ok: overall.atsBrier != null ? overall.atsBrier < 0.25 : false,
      blocker: "ATS still fails coin on TUNING identical-334 under E1 α=1.15",
    },
    Coach_CLV_C1_C6: {
      requirement: "C1–C6 on Coach pick CLV (locked)",
      lastMeasuredEngine: "ppg-per-drive-v1.1 phase-e (not clean E1)",
      lastVerdict: clvReport.verdict ?? "UNKNOWN",
      nMlWithClv: clvReport.nMlWithClv ?? null,
      meanClv: clvReport.meanClvProbPoints ?? null,
      earlyCachePicks: clvReport.earlyCachePicks ?? null,
      cleanE1Clv: "NOT_RUN — no early two-sided T−24h cache for 2025 TUNING; ODDS spend forbidden",
      blocker:
        "Coach CLV unmet historically (C1 fail n=15; early cache empty). Clean E1 has no CLV measurement. Paid early snaps not authorized.",
    },
    E4_injury: {
      requirement: "captureTimestamp < kickoff joins; null≠false",
      tuningCloses_injuryKnownNonNull: injuryNonNull,
      tuningCloses_qbOutNonNull: qbNonNull,
      status: "OPEN / INSUFFICIENT_DATA",
      blocker: "No historical pre-kick injury archive for TUNING or FINAL_EVAL",
    },
    P2_gate: {
      requirement: "NCAAF_GAME_LINE_SIM_VALIDATED false until human E6",
      status: "false (blocked) — correct",
    },
    Totals_ALTs: {
      status: "INSUFFICIENT_DATA — closeTotal / ALT prices absent",
      note: "Do not block ML research reporting but block product enablement",
    },
  },
  moneylineReadyForFinalEval: false,
  moneylineReadyForProduct: false,
  reasonNotReady:
    "TUNING-only M3 screen insufficient; FINAL_EVAL empty; Coach CLV blocked; injury E4 open; ATS S2 fail; gate false by policy",
};

// Finalize experiment proposal from actual evidence
const locShare = overall.locationShareOfAtsError ?? 0;
const afterLoc = overall.atsBrierLocationCorrected;
const shapeFails =
  afterLoc != null ? afterLoc >= 0.25 : true;
const midGaps = calibAll.filter((b) => b.n >= 15 && b.gap != null);
const worstGap = midGaps.sort(
  (a, b) => Math.abs(b.gap!) - Math.abs(a.gap!),
)[0];

// Require BOTH: (1) location share tiny, (2) reliability slope near 1 (discrimination OK),
// (3) Z2 and bin-gap σ-direction agree — else do not propose a β sweep.
const slope = relAll.slope;
const z2 = overall.meanZ2Cover;
const binsSayOverconfident =
  worstGap != null &&
  ((worstGap.lo < 0.5 && (worstGap.gap ?? 0) < -0.05) ||
    (worstGap.lo >= 0.5 && (worstGap.gap ?? 0) > 0.05));
const z2SaysWide = z2 != null && z2 < 0.85;
const sigmaDirectionConflict = binsSayOverconfident && z2SaysWide;
const discriminationOk = slope != null && slope >= 0.7;

if (
  shapeFails &&
  locShare < 0.008 &&
  discriminationOk &&
  !sigmaDirectionConflict &&
  worstGap &&
  Math.abs(worstGap.gap!) >= 0.04
) {
  proposedExperiment = {
    id: "E2_ats_sigma_shape",
    status: "PROPOSAL_ONLY — do not implement until approved",
    hypothesis:
      "ATS residual error after frozen E1 means is σ-shape with coherent direction; predeclared β grid only.",
    rationale: `locShare=${locShare.toFixed(4)}; slope=${slope}; z2=${z2}; worstGap=${worstGap.gap}`,
    requiredInputs: [
      "Frozen E1 α=1.15 margin means",
      "identical-334 closes eval-only",
      "No margin α sweep",
    ],
    evaluation:
      "Freeze rules before run; paired SE; else close with no β expansion.",
  };
} else {
  proposedExperiment = {
    id: "NONE",
    status: "NO_EXPERIMENT",
    rationale: `ATS error not isolatable to one bounded lever. locShare=${locShare.toFixed(4)}, atsAfterLoc=${afterLoc}, reliabilitySlope=${slope}, meanZ2Cover=${z2}, sigmaDirectionConflict=${sigmaDirectionConflict}, discriminationOk=${discriminationOk}. Margin-scale sweeps frozen; do not invent β/α scalars.`,
  };
}

const remainingBlockers = [
  {
    id: "FINAL_EVAL_EMPTY",
    severity: "hard",
    detail: "Reserved FINAL_EVAL fixtures/closes not built — no acceptance scoring allowed",
  },
  {
    id: "ATS_S2_FAIL_TUNING",
    severity: "hard",
    detail: `E1 α=1.15 identical-334 ATS Brier=${overall.atsBrier?.toFixed(4)} (need <0.25). Descriptive only on TUNING.`,
  },
  {
    id: "COACH_CLV",
    severity: "hard",
    detail:
      "C1–C6 unmet on last phase-e measure; clean candidate has no early two-sided cache; spend not authorized",
  },
  {
    id: "E4_INJURY",
    severity: "hard",
    detail: "injuryKnown/qbOut null on TUNING closes; no historical pre-kick joins",
  },
  {
    id: "TUNING_M3_NOT_FINAL",
    severity: "policy",
    detail:
      "Even if TUNING M3 screen is true for E1 α=1.15, policy forbids treating it as FINAL_EVAL authorization",
  },
  {
    id: "GATE_P2",
    severity: "policy",
    detail: "NCAAF_GAME_LINE_SIM_VALIDATED must stay false until human E6",
  },
  {
    id: "TOTALS_ALTS_DATA",
    severity: "market",
    detail: "closeTotal / posted ALT prices absent → INSUFFICIENT_DATA",
  },
];

const report = {
  generatedAt: new Date().toISOString(),
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  candidate: {
    id: "E1_alpha_1_15",
    alpha: ALPHA,
    freezeDoc: "docs/coach/ncaaf-clean-e1-candidate-freeze.md",
    marginScaleSweeps: "STOPPED",
  },
  ops: {
    finalEval: "UNTOUCHED",
    ncaafGate: false,
    injuryValidation: "OPEN",
    productionFreeze: true,
    voice: "paused",
    paidRetrieval: false,
    deployOta: false,
  },
  identicalN: rows.length,
  atsN: atsRows.length,
  atsDiagnosis: {
    overall,
    large,
    weekFolds,
    calibrationByPredictedCoverProb: {
      all: calibAll,
      week1: calibW1,
      largeGt14: calibLarge,
    },
    reliability: { all: relAll, week1: relW1, largeGt14: relLarge },
    locationVsShape: {
      definition:
        "Location = mean residual / mean cover residual. Shape diagnostic = ATS Brier after shifting every marginMean by slice meanResidual (oracle location); residual ATS error + calib gaps ⇒ shape/σ.",
      locationShareOfAtsError: overall.locationShareOfAtsError,
      atsBrierRaw: overall.atsBrier,
      atsBrierLocationCorrected: overall.atsBrierLocationCorrected,
      interpretation:
        locShare < 0.008
          ? "Location correction barely moves ATS Brier ⇒ remaining error is mostly shape/calibration."
          : "Location correction materially changes ATS Brier ⇒ location still contributes.",
    },
  },
  proposedExperiment,
  mlReadiness,
  remainingBlockers,
};

writeFileSync(
  join(FIX, "ncaaf-clean-e1-ats-ml-readiness.json"),
  JSON.stringify(report, null, 2) + "\n",
);

function fmt(x: number | null | undefined, d = 4): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(d);
}

const md = `# E1 α=1.15 — ATS diagnosis + ML readiness

**Stamp:** \`${NCAAF_CLEAN_ENGINE_STAMP}\`  
**Candidate:** **α=1.15 FROZEN** · margin-scale sweeps **STOPPED**  
**Generated:** ${report.generatedAt}  
**Ops:** FINAL_EVAL untouched · NCAAF blocked · injury OPEN · freeze · voice paused · no spend/deploy/OTA

## 1. Candidate freeze

| Item | Value |
|------|-------|
| Research candidate | E1 **α=1.15** |
| A0 | Archived baseline reference |
| Further α / margin sweeps | **No** |

## 2. ATS error diagnosis (identical-334)

### 2a. Overall / large / location vs shape

| Slice | nATS | ATS Brier | mean resid ± SE | mean cover resid | ATS Brier after oracle +μ | location share |
|-------|-----:|----------:|----------------:|-----------------:|--------------------------:|---------------:|
| overall | ${overall.nAts} | ${fmt(overall.atsBrier)} | ${fmt(overall.meanResidual, 3)}±${fmt(overall.meanResidualSe, 2)} | ${fmt(overall.meanCoverResidual, 3)} | ${fmt(overall.atsBrierLocationCorrected)} | ${fmt(overall.locationShareOfAtsError)} |
| large>14 | ${large.nAts} | ${fmt(large.atsBrier)} | ${fmt(large.meanResidual, 3)}±${fmt(large.meanResidualSe, 2)} | ${fmt(large.meanCoverResidual, 3)} | ${fmt(large.atsBrierLocationCorrected)} | ${fmt(large.locationShareOfAtsError)} |

Interpretation: ${report.atsDiagnosis.locationVsShape.interpretation}

Reliability (y ~ p): slope=${fmt(relAll.slope)} intercept=${fmt(relAll.intercept)} (n=${relAll.n}). Ideal slope≈1, intercept≈0.

### 2b. Calibration by predicted cover probability

| Bin | n | mean P | mean Y | P−Y | Brier |
|----:|--:|-------:|-------:|----:|------:|
${calibAll.map((b) => `| [${b.lo},${b.hi}) | ${b.n} | ${fmt(b.meanP)} | ${fmt(b.meanY)} | ${fmt(b.gap)} | ${fmt(b.brier)} |`).join("\n")}

### 2c. Time-ordered week folds

| Week | nATS | ATS Brier | mean resid | loc-corrected ATS | ML Δ |
|-----:|-----:|----------:|-----------:|------------------:|-----:|
${weekFolds.map((w) => `| ${w.label} | ${w.nAts} | ${fmt(w.atsBrier)} | ${fmt(w.meanResidual, 3)} | ${fmt(w.atsBrierLocationCorrected)} | ${fmt(w.deltaVsMarket)} |`).join("\n")}

## 3. Proposed next experiment

**${proposedExperiment.status}** — \`${proposedExperiment.id}\`

${proposedExperiment.hypothesis ? `**Hypothesis:** ${proposedExperiment.hypothesis}` : ""}

**Rationale:** ${proposedExperiment.rationale}

${proposedExperiment.evaluation ? `**Evaluation:** ${proposedExperiment.evaluation}` : ""}

## 4. Moneyline readiness (independent; thresholds unchanged)

| Criterion | TUNING screen (E1 α=1.15) | FINAL_EVAL / product |
|-----------|---------------------------|----------------------|
| M1 n≥200 | n=${rows.length} (screen ok) | **BLOCKED** — FINAL_EVAL empty |
| M2 Brier&lt;0.25 | ${fmt(mlB)} (${mlB < 0.25}) | unscored |
| M3 ≤ mkt+0.02 | Δ=${fmt(mlB - mkB)} (${mlB <= mkB + 0.02}) | **TUNING ≠ FINAL_EVAL** |
| M4 \|bias\|≤0.08 | ${fmt(mlBias)} | unscored |
| S2 ATS&lt;0.25 | ${fmt(overall.atsBrier)} (**fail**) | unscored |
| Coach CLV C1–C6 | not measured on clean E1; phase-e last=${clvReport.verdict} n=${clvReport.nMlWithClv} | **BLOCKED** (early cache / spend) |
| E4 injury | non-null injury=${injuryNonNull} qb=${qbNonNull} | **OPEN** |
| P2 gate | false | must stay false |

**Moneyline ready for FINAL_EVAL?** **NO**  
**Moneyline ready for product?** **NO**  
${mlReadiness.reasonNotReady}

## 5. Remaining blockers (no threshold changes)

${remainingBlockers.map((b) => `- **${b.id}** (${b.severity}): ${b.detail}`).join("\n")}

Fixture: \`artifacts/api-server/test/fixtures/ncaaf-clean-e1-ats-ml-readiness.json\`
`;

writeFileSync(join(FIX, "ncaaf-clean-e1-ats-ml-readiness.md"), md);
writeFileSync(join(DOCS, "ncaaf-clean-e1-ats-ml-readiness.md"), md);

console.log(
  JSON.stringify(
    {
      alpha: ALPHA,
      overallAts: overall.atsBrier,
      locCorrected: overall.atsBrierLocationCorrected,
      locShare: overall.locationShareOfAtsError,
      reliability: relAll,
      calibAll,
      proposedExperiment,
      mlM3screen: mlB <= mkB + 0.02,
      mlDelta: mlB - mkB,
      readyFinalEval: false,
      blockers: remainingBlockers.map((b) => b.id),
    },
    null,
    2,
  ),
);

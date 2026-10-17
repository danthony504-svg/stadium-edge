/**
 * Identical-ID compare (clean vs prior) + predefined ablations + week folds.
 * Protocol: docs/coach/ncaaf-clean-compare-ablation-protocol.md
 * No parameter retune to chase M3/S2. FINAL_EVAL untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLEAN_BASE_MARGIN_SD,
  CLEAN_HFA_POINTS,
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
};

type AuditRow = {
  eventId: string;
  week: number;
  actMargin: number;
  closeSpreadHome: number;
  marketPHome: number;
  yMlHome: number;
  yAtsHome: number | null;
  favAbs: number;
  large14: boolean;
  models: Record<string, { pMl: number; pAts: number | null; predMargin?: number }>;
};

type AblationId = "A0_full" | "A1_no_hfa" | "A2_fixed_sigma" | "A3_no_prior_seed";

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function brier(ps: number[], ys: number[]): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function rmse(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.sqrt(mean(xs.map((x) => x * x))!);
}

/** Prior identical-334 convention: large iff abs(spread) > 14. */
function isLargePrior(absSpread: number): boolean {
  return absSpread > 14;
}

function isLargeGe14(absSpread: number): boolean {
  return absSpread >= 14;
}

type MetricBlock = {
  nMl: number;
  nAts: number;
  nPushExcludedAts: number;
  mlBrier: number | null;
  mktBrier: number | null;
  coinBrier: number | null;
  deltaVsMarket: number | null;
  M3: boolean | null;
  atsBrier: number | null;
  atsCoinBrier: number | null;
  S2: boolean | null;
  meanResidual: number | null;
  rmseResidual: number | null;
  meanP: number | null;
  meanY: number | null;
  bias: number | null;
};

function metrics(
  rows: Array<{
    pMl: number;
    pMkt: number;
    yMl: number;
    pAts: number | null;
    yAts: number | null;
    residual: number | null;
  }>,
): MetricBlock {
  const ml = rows.filter((r) => Number.isFinite(r.pMl) && r.yMl != null);
  const ats = rows.filter((r) => r.pAts != null && r.yAts != null);
  const pushEx = rows.filter((r) => r.pAts != null && r.yAts == null).length;
  const ps = ml.map((r) => r.pMl);
  const ys = ml.map((r) => r.yMl);
  const mkt = ml.map((r) => r.pMkt);
  const coin = ml.map(() => 0.5);
  const atsP = ats.map((r) => r.pAts!);
  const atsY = ats.map((r) => r.yAts!);
  const atsCoin = ats.map(() => 0.5);
  const resid = ml.map((r) => r.residual).filter((x): x is number => x != null);
  const mlB = brier(ps, ys);
  const mkB = brier(mkt, ys);
  const atsB = brier(atsP, atsY);
  const meanP = mean(ps);
  const meanY = mean(ys);
  return {
    nMl: ml.length,
    nAts: ats.length,
    nPushExcludedAts: pushEx,
    mlBrier: mlB,
    mktBrier: mkB,
    coinBrier: brier(coin, ys),
    deltaVsMarket: mlB != null && mkB != null ? mlB - mkB : null,
    M3: mlB != null && mkB != null ? mlB <= mkB + 0.02 : null,
    atsBrier: atsB,
    atsCoinBrier: brier(atsCoin, atsY),
    S2: atsB != null ? atsB < 0.25 : null,
    meanResidual: mean(resid),
    rmseResidual: rmse(resid),
    meanP,
    meanY,
    bias: meanP != null && meanY != null ? meanP - meanY : null,
  };
}

const finish = loadJson<{
  exclusions: Array<{ eventId: string; reason: string }>;
  slices: Record<string, { n: number }>;
}>("ncaaf-tuning-identical-334-finish.json");
const audit = loadJson<{ rows: AuditRow[] }>(
  "ncaaf-tuning-pipeline-audit-predictions.json",
);
const tuningDoc = loadJson<{ games: CleanFixtureGameRow[] }>(
  "ncaaf-tuning-2025-w1-7-games.json",
);
const phaseEDoc = loadJson<{ games?: CleanFixtureGameRow[] } | CleanFixtureGameRow[]>(
  "ncaaf-phase-e-games.json",
);
const phaseE = Array.isArray(phaseEDoc)
  ? phaseEDoc
  : (phaseEDoc.games as CleanFixtureGameRow[]);
const closes = new Map(
  loadJson<{ games: CloseRow[] }>("ncaaf-tuning-2025-w1-7-closing-lines.json").games.map(
    (c) => [String(c.gameId), c],
  ),
);
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

// Reconcile 94 vs 107
const absSpreads = [...identicalIds].map((eid) =>
  Math.abs(closes.get(eid)!.closeSpreadHome!),
);
const reconcile14 = {
  spreadSource: "ncaaf-tuning-2025-w1-7-closing-lines.json closeSpreadHome",
  favoriteDefinition: "abs(closeSpreadHome); either side may be favorite",
  priorIdentical334Rule: "abs > 14 (favSize bands: abs<=14 is medium)",
  cleanFirstScreenRule: "abs >= 14",
  identical334N: identicalIds.size,
  nAbsGt14: absSpreads.filter((x) => x > 14).length,
  nAbsGe14: absSpreads.filter((x) => x >= 14).length,
  nAbsEq14: absSpreads.filter((x) => x === 14).length,
  finishSliceN: finish.slices?.identical_334_large_14plus?.n ?? 94,
  pushHandling: "ATS pushes excluded (yAts null); ML decisive finals only",
};

type CleanPred = {
  eventId: string;
  week: number;
  ablation: AblationId;
  pMl: number;
  pMkt: number;
  yMl: number;
  pAts: number | null;
  yAts: number | null;
  residual: number | null;
  absSpread: number;
  marginMean: number;
  marginSd: number;
  uncertainty: number;
  evaluableSupported: boolean;
  productionReleaseApproved: false;
};

function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

function runAblation(ablation: AblationId): CleanPred[] {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  if (ablation !== "A3_no_prior_seed") {
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
  }

  const out: CleanPred[] = [];
  const games = [...tuningDoc.games].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  for (const g of games) {
    const pre = buildPregameFromFixtureRow(g, { useVenueSidecar: true });
    const close = closes.get(String(g.eventId));

    // Predict variants
    let pred = predictScoreMargin({ pregame: pre, strength });
    if (pred.ok) {
      let marginMean = pred.marginMean;
      let marginSd = pred.marginSd;
      let uncertainty = pred.uncertainty;
      let homeScoreMean = pred.homeScoreMean;
      let awayScoreMean = pred.awayScoreMean;

      if (ablation === "A1_no_hfa" && pred.hfaApplied) {
        // Remove HFA from means
        homeScoreMean -= CLEAN_HFA_POINTS / 2;
        awayScoreMean += CLEAN_HFA_POINTS / 2;
        marginMean = homeScoreMean - awayScoreMean;
      }
      if (ablation === "A2_fixed_sigma") {
        uncertainty = 0;
        marginSd = CLEAN_BASE_MARGIN_SD;
      }

      if (
        identicalIds.has(String(g.eventId)) &&
        pred.evaluableSupported &&
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
          const ats = settleAtsHome({
            homeScore: g.homeFg,
            awayScore: g.awayFg,
            homeSpreadLine: close.closeSpreadHome,
            decided: true,
          });
          out.push({
            eventId: g.eventId,
            week: g.week ?? 0,
            ablation,
            pMl: pHomeMlFromMargin(marginMean, marginSd),
            pMkt: americanToImplied(close.closeMlHome),
            yMl: ml.yHomeWin,
            pAts: pHomeCoverFromMargin(marginMean, marginSd, close.closeSpreadHome),
            yAts: ats.ok ? ats.yHomeCover : null,
            residual: g.homeFg - g.awayFg - marginMean,
            absSpread: Math.abs(close.closeSpreadHome),
            marginMean,
            marginSd,
            uncertainty,
            evaluableSupported: true,
            productionReleaseApproved: false,
          });
        }
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

const ablations: AblationId[] = [
  "A0_full",
  "A1_no_hfa",
  "A2_fixed_sigma",
  "A3_no_prior_seed",
];
const ablationRows: Record<AblationId, CleanPred[]> = {
  A0_full: [],
  A1_no_hfa: [],
  A2_fixed_sigma: [],
  A3_no_prior_seed: [],
};
for (const id of ablations) {
  ablationRows[id] = runAblation(id);
}

function sliceClean(rows: CleanPred[], pred: (r: CleanPred) => boolean) {
  return metrics(rows.filter(pred));
}

const a0 = ablationRows.A0_full;
const cleanSlices = {
  identical_334: sliceClean(a0, () => true),
  identical_334_week1: sliceClean(a0, (r) => r.week === 1),
  identical_334_large_gt14: sliceClean(a0, (r) => isLargePrior(r.absSpread)),
  identical_334_large_ge14_sensitivity: sliceClean(a0, (r) =>
    isLargeGe14(r.absSpread),
  ),
};

// Prior models from audit, filtered to identical IDs
const auditIdentical = audit.rows.filter((r) => identicalIds.has(String(r.eventId)));
function priorSlice(
  model: string,
  pred: (r: AuditRow) => boolean,
): MetricBlock {
  const rs = auditIdentical.filter(pred).map((r) => {
    const m = r.models[model]!;
    return {
      pMl: m.pMl,
      pMkt: r.marketPHome,
      yMl: r.yMlHome,
      pAts: m.pAts,
      yAts: r.yAtsHome,
      residual:
        m.predMargin != null ? r.actMargin - m.predMargin : null,
    };
  });
  return metrics(rs);
}

const priorCompare = {
  locked_drive_teamMean: {
    identical_334: priorSlice("locked_drive_teamMean", () => true),
    identical_334_week1: priorSlice("locked_drive_teamMean", (r) => r.week === 1),
    identical_334_large_gt14: priorSlice(
      "locked_drive_teamMean",
      (r) => isLargePrior(r.favAbs),
    ),
  },
  ts_full: {
    identical_334: priorSlice("ts_full", () => true),
    identical_334_week1: priorSlice("ts_full", (r) => r.week === 1),
    identical_334_large_gt14: priorSlice("ts_full", (r) => isLargePrior(r.favAbs)),
  },
};

const ablationSlices: Record<string, unknown> = {};
for (const id of ablations) {
  const rows = ablationRows[id];
  ablationSlices[id] = {
    identical_334: sliceClean(rows, () => true),
    week1: sliceClean(rows, (r) => r.week === 1),
    large_gt14: sliceClean(rows, (r) => isLargePrior(r.absSpread)),
  };
}

// Time-ordered folds: score week k only
const folds: Record<string, MetricBlock> = {};
for (const k of [1, 2, 3, 4, 5, 6, 7]) {
  folds[`week_${k}`] = sliceClean(a0, (r) => r.week === k);
}

const report = {
  generatedAt: new Date().toISOString(),
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  protocol: "docs/coach/ncaaf-clean-compare-ablation-protocol.md",
  naming: {
    evaluableSupported:
      "Research inputs complete enough to evaluate — NOT production approval",
    productionReleaseApproved: false,
    retiredName: "releaseEligible",
    evaluableCountNote:
      "A0 full walk evaluableSupported on TUNING ≈ 350; none are production-approved",
  },
  finalEval: "UNTOUCHED",
  injuryValidation: "OPEN",
  ops: {
    paidRetrieval: false,
    deployOta: false,
    ncaafUnlock: false,
  },
  reconcile14plus: reconcile14,
  identicalIdCompare: {
    nIds: identicalIds.size,
    clean_A0: cleanSlices,
    prior: priorCompare,
    note: "Same event IDs; venue sidecar on clean; prior from pipeline-audit archive (ts_full ≈ team-strength path)",
  },
  ablationsPredefined: {
    protocol: ["A0_full", "A1_no_hfa", "A2_fixed_sigma", "A3_no_prior_seed"],
    noThresholdChasing: true,
    results: ablationSlices,
  },
  timeOrderedFolds: folds,
  residualSign:
    "residual=(homeScore-awayScore)-marginMean; positive ⇒ understated home edge",
};

writeFileSync(
  join(FIX, "ncaaf-clean-compare-ablation.json"),
  JSON.stringify(report, null, 2) + "\n",
);

function fmt(m: MetricBlock | null | undefined): string {
  if (!m) return "—";
  return `nML=${m.nMl} nATS=${m.nAts} (pushEx=${m.nPushExcludedAts}) | ML ${m.mlBrier?.toFixed(4)} Δ=${m.deltaVsMarket?.toFixed(4)} M3=${m.M3} | ATS ${m.atsBrier?.toFixed(4)} S2=${m.S2} | resid ${m.meanResidual?.toFixed(2)}±rmse ${m.rmseResidual?.toFixed(2)}`;
}

const md = `# Clean vs prior — identical IDs + ablations

**Stamp:** \`${NCAAF_CLEAN_ENGINE_STAMP}\`  
**Generated:** ${report.generatedAt}  
**Protocol predefined:** \`ncaaf-clean-compare-ablation-protocol.md\`  
**evaluableSupported ≠ production approval** (\`productionReleaseApproved=false\`)

## 14+ reconcile (94 vs 107)

| Item | Value |
|------|-------|
| Spread source | \`closeSpreadHome\` (TUNING Odds archive) |
| Prior identical-334 rule | **abs > 14** → n=**${reconcile14.nAbsGt14}** |
| Clean first screen rule | abs ≥ 14 → n=**${reconcile14.nAbsGe14}** |
| Exact abs==14 | **${reconcile14.nAbsEq14}** |
| Push handling | ATS pushes excluded; ML decisive only |

## Identical-334 compare (canonical large = abs>14)

### Clean A0 (venue sidecar)

| Slice | Metrics |
|-------|---------|
| All | ${fmt(cleanSlices.identical_334)} |
| Week 1 | ${fmt(cleanSlices.identical_334_week1)} |
| Large abs>14 | ${fmt(cleanSlices.identical_334_large_gt14)} |
| Large abs≥14 (sensitivity) | ${fmt(cleanSlices.identical_334_large_ge14_sensitivity)} |

### Prior \`locked_drive_teamMean\`

| Slice | Metrics |
|-------|---------|
| All | ${fmt(priorCompare.locked_drive_teamMean.identical_334)} |
| Week 1 | ${fmt(priorCompare.locked_drive_teamMean.identical_334_week1)} |
| Large abs>14 | ${fmt(priorCompare.locked_drive_teamMean.identical_334_large_gt14)} |

### Prior \`ts_full\` (archive)

| Slice | Metrics |
|-------|---------|
| All | ${fmt(priorCompare.ts_full.identical_334)} |
| Week 1 | ${fmt(priorCompare.ts_full.identical_334_week1)} |
| Large abs>14 | ${fmt(priorCompare.ts_full.identical_334_large_gt14)} |

## Ablations (predefined — no retune)

| Ablation | All | Week1 | Large >14 |
|----------|-----|-------|-----------|
| A0_full | ${fmt((ablationSlices.A0_full as any).identical_334)} | ${fmt((ablationSlices.A0_full as any).week1)} | ${fmt((ablationSlices.A0_full as any).large_gt14)} |
| A1_no_hfa | ${fmt((ablationSlices.A1_no_hfa as any).identical_334)} | ${fmt((ablationSlices.A1_no_hfa as any).week1)} | ${fmt((ablationSlices.A1_no_hfa as any).large_gt14)} |
| A2_fixed_sigma | ${fmt((ablationSlices.A2_fixed_sigma as any).identical_334)} | ${fmt((ablationSlices.A2_fixed_sigma as any).week1)} | ${fmt((ablationSlices.A2_fixed_sigma as any).large_gt14)} |
| A3_no_prior_seed | ${fmt((ablationSlices.A3_no_prior_seed as any).identical_334)} | ${fmt((ablationSlices.A3_no_prior_seed as any).week1)} | ${fmt((ablationSlices.A3_no_prior_seed as any).large_gt14)} |

## Time-ordered week folds (A0)

${[1, 2, 3, 4, 5, 6, 7].map((k) => `- **W${k}:** ${fmt(folds[`week_${k}`])}`).join("\n")}

## Uncertainty note

Report **exact** \`nMl\` / \`nAts\` (and ATS push exclusions) with every Brier. Sample sizes on Week-1 (~47) and large (~94) are thin — treat slice M3/S2 flags as descriptive only, not acceptance.

FINAL_EVAL untouched · E4 open · no spend/deploy/OTA/unlock.
`;

writeFileSync(join(FIX, "ncaaf-clean-compare-ablation.md"), md);
writeFileSync(join(DOCS, "ncaaf-clean-compare-ablation.md"), md);
console.log(JSON.stringify({
  reconcile14,
  cleanAll: cleanSlices.identical_334,
  cleanW1: cleanSlices.identical_334_week1,
  cleanLarge: cleanSlices.identical_334_large_gt14,
  priorDriveAll: priorCompare.locked_drive_teamMean.identical_334,
  priorTsAll: priorCompare.ts_full.identical_334,
  ablationW1: Object.fromEntries(
    ablations.map((id) => [id, (ablationSlices[id] as any).week1]),
  ),
}, null, 2));

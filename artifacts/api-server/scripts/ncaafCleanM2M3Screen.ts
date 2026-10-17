/**
 * Rerun M2 with venue sidecar, then M3 TUNING ML/ATS screen (eval-only closes).
 * No FINAL_EVAL. No Odds spend. No gate flip.
 *
 * Residual sign convention:
 *   residual = (homeScore - awayScore) - marginMean
 *   positive ⇒ actual home margin larger than predicted (model understated home edge)
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
  closeMlAway?: number | null;
  closeSpreadHome?: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function americanToImpliedProb(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
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

const tuningDoc = loadJson<{ games: CleanFixtureGameRow[] }>(
  "ncaaf-tuning-2025-w1-7-games.json",
);
const phaseEDoc = loadJson<{ games?: CleanFixtureGameRow[] } | CleanFixtureGameRow[]>(
  "ncaaf-phase-e-games.json",
);
const phaseE = Array.isArray(phaseEDoc)
  ? phaseEDoc
  : (phaseEDoc.games as CleanFixtureGameRow[]);
const closesDoc = loadJson<{ games: CloseRow[] }>(
  "ncaaf-tuning-2025-w1-7-closing-lines.json",
);
const closes = new Map(closesDoc.games.map((c) => [String(c.gameId), c]));

const prior2024 = phaseE.filter((g) => g.season === 2024);
const strength = new CleanOppAdjStrength({ season: 2025 });
strength.seedFromPriorSeason(
  prior2024
    .filter((g) => g.homeFg != null && g.awayFg != null)
    .map((g) => ({
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeFg: g.homeFg!,
      awayFg: g.awayFg!,
      season: g.season,
      kickoffIso: g.kickoffIso,
    })),
);

const tuning = [...tuningDoc.games].sort((a, b) =>
  String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
);

type PredRow = {
  eventId: string;
  week: number;
  matchupScope: string;
  ok: boolean;
  evaluableSupported: boolean;
  reason?: string;
  marginMean?: number;
  marginSd?: number;
  pHomeMl?: number;
  pHomeCover?: number;
  closeSpreadHome?: number | null;
  yMl?: number | null;
  yAts?: number | null;
  pMktMl?: number | null;
  residual?: number | null;
  absCloseSpread?: number | null;
  hfaApplied?: boolean;
  venueKind?: string;
};

const rows: PredRow[] = [];
const withhold: Record<string, number> = {};
let venueHome = 0;
let venueNeutral = 0;
let venueUnknown = 0;
let evaluableSupported = 0;
let okPred = 0;

for (const g of tuning) {
  const pre = buildPregameFromFixtureRow(g, { useVenueSidecar: true });
  if (pre.venue.kind === "home") venueHome++;
  else if (pre.venue.kind === "neutral") venueNeutral++;
  else venueUnknown++;

  const pred = predictScoreMargin({ pregame: pre, strength });
  const close = closes.get(String(g.eventId));
  const base: PredRow = {
    eventId: g.eventId,
    week: g.week ?? 0,
    matchupScope: pre.matchupScope,
    ok: pred.ok,
    evaluableSupported: pred.ok ? pred.evaluableSupported : false,
    venueKind: pre.venue.kind,
  };

  if (!pred.ok) {
    withhold[pred.reason] = (withhold[pred.reason] ?? 0) + 1;
    base.reason = pred.reason;
    rows.push(base);
  } else {
    okPred++;
    if (pred.evaluableSupported) evaluableSupported++;
    const pMl = pHomeMlFromMargin(pred.marginMean, pred.marginSd);
    const spread = close?.closeSpreadHome ?? null;
    const pCover =
      spread != null && Number.isFinite(spread)
        ? pHomeCoverFromMargin(pred.marginMean, pred.marginSd, spread)
        : undefined;
    let yMl: number | null = null;
    let yAts: number | null = null;
    let residual: number | null = null;
    if (g.homeFg != null && g.awayFg != null) {
      const ml = settleMoneyline({
        homeScore: g.homeFg,
        awayScore: g.awayFg,
        decided: true,
      });
      yMl = ml.ok ? ml.yHomeWin : null;
      residual = g.homeFg - g.awayFg - pred.marginMean;
      if (spread != null && Number.isFinite(spread)) {
        const ats = settleAtsHome({
          homeScore: g.homeFg,
          awayScore: g.awayFg,
          homeSpreadLine: spread,
          decided: true,
        });
        yAts = ats.ok ? ats.yHomeCover : null;
      }
    }
    const pMkt =
      close?.closeMlHome != null
        ? americanToImpliedProb(close.closeMlHome)
        : null;
    rows.push({
      ...base,
      marginMean: pred.marginMean,
      marginSd: pred.marginSd,
      pHomeMl: pMl,
      pHomeCover: pCover,
      closeSpreadHome: spread,
      yMl,
      yAts,
      pMktMl: pMkt,
      residual,
      absCloseSpread: spread != null ? Math.abs(spread) : null,
      hfaApplied: pred.hfaApplied,
    });
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

/** M3 screen: supported FBS–FBS, ok, evaluableSupported, with closes + labels. */
function screen(predicate: (r: PredRow) => boolean) {
  const set = rows.filter(
    (r) =>
      r.ok &&
      r.evaluableSupported &&
      r.matchupScope === "fbs_fbs" &&
      r.pHomeMl != null &&
      r.yMl != null &&
      r.pMktMl != null &&
      predicate(r),
  );
  const ps = set.map((r) => r.pHomeMl!);
  const ys = set.map((r) => r.yMl!);
  const mkt = set.map((r) => r.pMktMl!);
  const coin = set.map(() => 0.5);
  const atsSet = set.filter((r) => r.pHomeCover != null && r.yAts != null);
  const atsP = atsSet.map((r) => r.pHomeCover!);
  const atsY = atsSet.map((r) => r.yAts!);
  const atsCoin = atsSet.map(() => 0.5);
  const residuals = set
    .map((r) => r.residual)
    .filter((x): x is number => x != null);
  const brierEng = brier(ps, ys);
  const brierMkt = brier(mkt, ys);
  const brierCoin = brier(coin, ys);
  const brierAts = brier(atsP, atsY);
  const brierAtsCoin = brier(atsCoin, atsY);
  return {
    nMl: set.length,
    nAts: atsSet.length,
    mlBrierEngine: brierEng,
    mlBrierMarket: brierMkt,
    mlBrierCoin: brierCoin,
    mlDeltaVsMarket:
      brierEng != null && brierMkt != null ? brierEng - brierMkt : null,
    mlM3: brierEng != null && brierMkt != null ? brierEng <= brierMkt + 0.02 : null,
    mlBias: mean(ps.map((p, i) => p - ys[i]!)),
    atsBrierEngine: brierAts,
    atsBrierCoin: brierAtsCoin,
    atsS2: brierAts != null ? brierAts < 0.25 : null,
    meanResidual: mean(residuals),
    rmseResidual:
      residuals.length > 0
        ? Math.sqrt(mean(residuals.map((x) => x * x))!)
        : null,
  };
}

const overall = screen(() => true);
const week1 = screen((r) => r.week === 1);
// Canonical prior identical-334 large: abs > 14 (not >= 14).
const largeFav = screen((r) => (r.absCloseSpread ?? 0) > 14);
const largeFavGe14 = screen((r) => (r.absCloseSpread ?? 0) >= 14);

const m2 = {
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  nTuningGames: tuning.length,
  venue: {
    home: venueHome,
    neutral: venueNeutral,
    unknown: venueUnknown,
    evaluableSupported,
  },
  okPredictions: okPred,
  withhold,
};

const residualSignDefinition = {
  formula: "residual = (homeScore - awayScore) - marginMean",
  positiveMeans:
    "Actual home margin larger than predicted (model understated home edge / overstated away)",
  negativeMeans:
    "Actual home margin smaller than predicted (model overstated home edge)",
  priorM2WithoutVenueHfa: {
    meanResidual: 6.110807308746756,
    note: "Computed when all venues were unknown so HFA was withheld — positive bias expected",
  },
};

const report = {
  generatedAt: new Date().toISOString(),
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  split: "TUNING",
  finalEval: "UNTOUCHED",
  closesInFeatures: false,
  injury: "injury_unavailable (E4 open)",
  naming: { evaluableSupported: "research eval inputs — NOT production approval", productionReleaseApproved: false },
  totalsAlts: "do_not_block_ml_ats_research",
  ops: {
    ncaafGate: false,
    freeze: "armed",
    voice: "paused",
    paidRetrieval: "none",
    deployOta: "none",
  },
  fbsFcsReconcile: {
    fullEspnFbsFcs: 119,
    fairCohortFbsFcs: 85,
    verdict: "cohort_difference_not_classification_error",
    doc: "docs/coach/ncaaf-clean-fbs-fcs-cohort-reconcile.md",
  },
  m2WithVenueSidecar: m2,
  residualSignDefinition,
  m3Screen: {
    note: "Screening only on supported FBS–FBS + evaluableSupported + close-joined labels. Not FINAL_EVAL. Rebuild ≠ pass.",
    overall,
    week1,
    largeFavorite14plus_gt14: largeFav,
    largeFavorite14plus_ge14_sensitivity: largeFavGe14,
    largeFavoriteNote:
      "Canonical abs>14 matches identical-334 (n≈94). abs>=14 was first-screen bug (n≈107).",
    lockedCriteriaReminder: {
      M3: "brierEngine <= brierMarket + 0.02",
      S2: "brierEngine < 0.25 (ATS vs coin)",
    },
  },
};

writeFileSync(
  join(FIX, "ncaaf-clean-m2-m3-screen.json"),
  JSON.stringify(report, null, 2) + "\n",
);

const md = `# Clean engine M2 rerun + M3 TUNING screen

**Stamp:** \`${NCAAF_CLEAN_ENGINE_STAMP}\`  
**Generated:** ${report.generatedAt}  
**FINAL_EVAL:** UNTOUCHED · closes eval-only · injury unavailable (E4 open) · no spend/deploy/OTA/unlock

## Venue sidecar (M2 rerun)

| Kind | n |
|------|--:|
| Home stadium | ${venueHome} |
| Neutral | ${venueNeutral} |
| Unknown | ${venueUnknown} |
| ok predictions | ${okPred} |
| evaluableSupported | ${evaluableSupported} |

Withholds: \`${JSON.stringify(withhold)}\`

## FBS–FCS 119 vs 85

**Cohort difference, not classification error** — see \`ncaaf-clean-fbs-fcs-cohort-reconcile.md\`.
Full ESPN TUNING FBS–FCS=119; fair close-joined FBS–FCS=85 (421 − 334 − 2 unrated).

## Residual sign

\`residual = (homeScore − awayScore) − marginMean\`

- **Positive** → actual home margin larger than predicted (model understated home edge)
- **Negative** → actual home margin smaller than predicted
- Prior M2 (all venues unknown, HFA withheld): mean residual **+6.11**

## M3 TUNING screen (supported + verified venue + closes)

| Slice | n ML | ML Brier | Mkt Brier | Δ vs mkt | M3 | ATS n | ATS Brier | S2 | mean residual |
|-------|-----:|---------:|----------:|---------:|:--:|------:|----------:|:--:|--------------:|
| Overall | ${overall.nMl} | ${overall.mlBrierEngine?.toFixed(4)} | ${overall.mlBrierMarket?.toFixed(4)} | ${overall.mlDeltaVsMarket?.toFixed(4)} | ${overall.mlM3} | ${overall.nAts} | ${overall.atsBrierEngine?.toFixed(4)} | ${overall.atsS2} | ${overall.meanResidual?.toFixed(3)} |
| Week 1 | ${week1.nMl} | ${week1.mlBrierEngine?.toFixed(4)} | ${week1.mlBrierMarket?.toFixed(4)} | ${week1.mlDeltaVsMarket?.toFixed(4)} | ${week1.mlM3} | ${week1.nAts} | ${week1.atsBrierEngine?.toFixed(4)} | ${week1.atsS2} | ${week1.meanResidual?.toFixed(3)} |
| 14+ fav | ${largeFav.nMl} | ${largeFav.mlBrierEngine?.toFixed(4)} | ${largeFav.mlBrierMarket?.toFixed(4)} | ${largeFav.mlDeltaVsMarket?.toFixed(4)} | ${largeFav.mlM3} | ${largeFav.nAts} | ${largeFav.atsBrierEngine?.toFixed(4)} | ${largeFav.atsS2} | ${largeFav.meanResidual?.toFixed(3)} |

Baselines: coin ML Brier overall ${overall.mlBrierCoin?.toFixed(4)}; coin ATS ${overall.atsBrierCoin?.toFixed(4)}.

**Screening only — not a restore / FINAL_EVAL pass.**
`;

writeFileSync(join(FIX, "ncaaf-clean-m2-m3-screen.md"), md);
writeFileSync(join(DOCS, "ncaaf-clean-m2-m3-screen.md"), md);
console.log(JSON.stringify(report, null, 2));

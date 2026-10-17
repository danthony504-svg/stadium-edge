/**
 * M2 score-distribution walk on TUNING (existing data only).
 * No closes in features. No FINAL_EVAL. No Odds spend.
 *
 * Usage:
 *   node --import ./test/register-hooks.mjs ./scripts/ncaafCleanM2Report.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  CleanOppAdjStrength,
  NCAAF_CLEAN_ENGINE_STAMP,
  buildPregameFromFixtureRow,
  predictScoreMargin,
  resultFromFixtureRow,
  settleMoneyline,
  type CleanFixtureGameRow,
} from "../src/lib/sportSim/ncaafClean/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const OUT_JSON = join(FIX, "ncaaf-clean-m2-report.json");
const OUT_MD = join(FIX, "ncaaf-clean-m2-report.md");
const DOCS = join(HERE, "../../../docs/coach/ncaaf-clean-m2-report.md");

function loadGames(name: string): CleanFixtureGameRow[] {
  const raw = JSON.parse(readFileSync(join(FIX, name), "utf8"));
  return (Array.isArray(raw) ? raw : raw.games) as CleanFixtureGameRow[];
}

const tuning = loadGames("ncaaf-tuning-2025-w1-7-games.json");
const phaseE = loadGames("ncaaf-phase-e-games.json");
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

tuning.sort((a, b) => Date.parse(a.kickoffIso) - Date.parse(b.kickoffIso));

const reasonCounts: Record<string, number> = {};
let okPred = 0;
let releaseEligible = 0;
let venueUnknown = 0;
let injuryUnavailable = 0;
let tiedOrInvalid = 0;
let fbsFbs = 0;
const marginResiduals: number[] = [];

for (const g of tuning) {
  const pre = buildPregameFromFixtureRow(g);
  if (pre.matchupScope === "fbs_fbs") fbsFbs++;
  if (pre.venue.kind === "unknown") venueUnknown++;

  const pred = predictScoreMargin({ pregame: pre, strength });
  if (!pred.ok) {
    reasonCounts[pred.reason] = (reasonCounts[pred.reason] ?? 0) + 1;
  } else {
    okPred++;
    if (pred.releaseEligible) releaseEligible++;
    if (pred.missingOptional.includes("injury_unavailable")) injuryUnavailable++;
    if (pred.missingOptional.includes("venue_unknown_material")) {
      /* counted via venueUnknown on pregame */
    }
    const res = resultFromFixtureRow(g);
    if (res && res.decided) {
      const ml = settleMoneyline({
        homeScore: res.homeScore,
        awayScore: res.awayScore,
        decided: true,
      });
      if (!ml.ok) tiedOrInvalid++;
      else {
        marginResiduals.push(res.homeScore - res.awayScore - pred.marginMean);
      }
    } else {
      tiedOrInvalid++;
    }
  }

  // Causal update after predict (only decided scores)
  if (g.homeFg != null && g.awayFg != null && Number.isFinite(g.homeFg) && Number.isFinite(g.awayFg)) {
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

const mean =
  marginResiduals.length > 0
    ? marginResiduals.reduce((a, b) => a + b, 0) / marginResiduals.length
    : null;
const rmse =
  marginResiduals.length > 0
    ? Math.sqrt(
        marginResiduals.reduce((a, b) => a + b * b, 0) / marginResiduals.length,
      )
    : null;

const report = {
  generatedAt: new Date().toISOString(),
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  split: "TUNING",
  finalEval: "UNTOUCHED",
  nTuningGames: tuning.length,
  nFbsFbsRows: fbsFbs,
  nOkPredictions: okPred,
  nReleaseEligible: releaseEligible,
  nVenueUnknown: venueUnknown,
  nInjuryUnavailableOnOk: injuryUnavailable,
  nTiedOrInvalidFinalsOnOk: tiedOrInvalid,
  withholdReasons: reasonCounts,
  scoreOnlyDiag: {
    nMarginResiduals: marginResiduals.length,
    meanResidual: mean,
    rmseResidual: rmse,
    note: "Informational only — not M3/S2; closes not used in features",
  },
  dataBlockersBeforeM3: [
    {
      id: "venue_fields_absent",
      severity: "release_blocker",
      detail:
        "TUNING/phase-e game fixtures lack venueKind/neutralSite fields — all rows recover as venue.kind=unknown → releaseEligible=false. Need free ESPN venue recovery retag before release-eligible preds.",
    },
    {
      id: "injury_snapshots_absent",
      severity: "validation_gap",
      detail:
        "No pre-kick injury snapshots on historical TUNING — injury_unavailable on all ok preds. Allowed for research; does not satisfy E4 injury validation.",
    },
    {
      id: "close_totals_alt_absent",
      severity: "market_gap",
      detail:
        "closeTotal / ALT archives still absent — totals/ALT remain INSUFFICIENT_DATA (unchanged).",
    },
    {
      id: "final_eval_untouched",
      severity: "policy",
      detail: "FINAL_EVAL fixtures not built — correct until candidate lock after M3 screen.",
    },
  ],
  ops: {
    ncaafGate: false,
    productionFreeze: "armed",
    voice: "paused",
    paidRetrieval: "none",
    deployOta: "none",
  },
};

writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + "\n");

const md = `# Clean engine M2 report — \`${NCAAF_CLEAN_ENGINE_STAMP}\`

**Generated:** ${report.generatedAt}  
**Split:** TUNING 2025 w1–7 only · **FINAL_EVAL:** UNTOUCHED  
**No closes in features · no Odds spend · gate false · freeze armed · voice paused**

## Counts

| Metric | n |
|--------|--:|
| TUNING games | ${report.nTuningGames} |
| FBS–FBS rows | ${report.nFbsFbsRows} |
| ok predictions (rated FBS–FBS) | ${report.nOkPredictions} |
| releaseEligible | ${report.nReleaseEligible} |
| venue.kind=unknown | ${report.nVenueUnknown} |
| injury_unavailable (on ok) | ${report.nInjuryUnavailableOnOk} |
| tied/invalid finals (on ok path) | ${report.nTiedOrInvalidFinalsOnOk} |

### Withhold reasons

\`\`\`json
${JSON.stringify(reasonCounts, null, 2)}
\`\`\`

## Score-only residual (informational)

| | |
|--|--:|
| n | ${marginResiduals.length} |
| mean (actual−pred margin) | ${mean?.toFixed(3) ?? "n/a"} |
| RMSE | ${rmse?.toFixed(3) ?? "n/a"} |

Not an M3/S2 claim.

## Data blockers before M3

${report.dataBlockersBeforeM3
  .map((b) => `- **${b.id}** (${b.severity}): ${b.detail}`)
  .join("\n")}

## Next

Do **not** start M3 close-joined tuning until venue recovery path is agreed (or M3 is explicitly scoped as screen-only with releaseEligible=false acknowledged).
`;

writeFileSync(OUT_MD, md);
writeFileSync(DOCS, md);
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_MD}`);
console.log(`Wrote ${DOCS}`);

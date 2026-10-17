/**
 * Cache-only NCAAF market diagnosis + release package fragment.
 * No Odds HTTP. No FINAL_EVAL retune. No gate flip.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import {
  diagnoseNcaafMarkets,
  lockedCriteriaBundle,
} from "../src/lib/sportSim/ncaafClean/marketDiagnosis.ts";
import {
  NCAAF_MARKET_SIM_VALIDATED,
  NCAAF_GAME_LINE_SIM_VALIDATED,
} from "../src/lib/sportSim/ncaafClean/marketGates.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");

function gitSha(rev = "HEAD"): string {
  try {
    return execSync(`git rev-parse ${rev}`, {
      cwd: join(HERE, "../../.."),
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

const diagnosis = diagnoseNcaafMarkets();
const sha = gitSha();
const archiveTip = "b000b2bbec08b015bca220d42dd44319be16fa3c";

const release = {
  title: "NCAAF restoration release package",
  generatedAt: new Date().toISOString(),
  branch: "cursor/ncaaf-restoration-e2e-3645",
  shas: {
    restorationTip: sha,
    finalEvalArchiveBase: archiveTip,
    frozenFinalEvalScoreCommit: "b9772e541cf9a785fe45a4fe0298aa088d49e7ee",
    e4CompletionPathCommit: "b000b2bbec08b015bca220d42dd44319be16fa3c",
  },
  productGates: {
    legacyMaster: NCAAF_GAME_LINE_SIM_VALIDATED,
    perMarket: { ...NCAAF_MARKET_SIM_VALIDATED },
  },
  markets: {
    moneyline: {
      status: diagnosis.moneyline.metricsClear
        ? "PASS_METRICS_PRODUCT_BLOCKED"
        : "FAIL_METRICS",
      productValidated: false,
      evidence: diagnosis.moneyline.source,
      blockers: ["E4 OPEN_INSUFFICIENT_DATA", "E6 not requested"],
    },
    spreads: {
      status: "FAIL_VS_COIN_SEPARATE_GATE",
      productValidated: false,
      evidence: diagnosis.spreads.measured.source,
      blockers: [diagnosis.spreads.gap],
    },
    totals: {
      status: "INSUFFICIENT_DATA",
      productValidated: false,
      evidence: "phase-e missing closeTotal",
      blockers: [diagnosis.totals.gap],
    },
    alts: {
      status: "INSUFFICIENT_DATA",
      productValidated: false,
      evidence: "phase-e missing altPostedPrices",
      blockers: [diagnosis.alts.gap],
    },
  },
  finalEvalImmutable: true,
  retunedAgainstFinalEval: false,
  thresholdsLowered: false,
  injury: {
    status: "OPEN_INSUFFICIENT_DATA",
    path: "forward_espn_prospective + parallel ScoreTape Explorer $0",
    mBaseFrozen: true,
    mInjOnFrozenMl: false,
    collectorActivated: false,
  },
  costs: {
    thisTurnUsd: 0,
    paidOddsHttp: 0,
    pendingAuthorization: diagnosis.dataDependencies.filter((d) => !d.authorized),
  },
  deployment: {
    productionDeploy: false,
    ota: false,
    unlock: false,
    voice: "paused",
    previewPublication: "limited to existing cap/provenance candidate only — not this branch",
  },
  rollback: {
    steps: [
      "Do not merge unlock commits; product gates remain false on this tip",
      "If preview tip drifts: republish authorized cap/provenance SHA only",
      "Revert this branch tip to archive base b000b2bb if needed: git reset --hard b000b2bb",
      "FINAL_EVAL fixtures are immutable — never restore by editing frozen score JSON",
    ],
  },
  lockedCriteria: lockedCriteriaBundle(),
  diagnosis,
};

mkdirSync(FIXTURES, { recursive: true });
writeFileSync(
  join(FIXTURES, "ncaaf-market-diagnosis.json"),
  JSON.stringify(diagnosis, null, 2) + "\n",
);
writeFileSync(
  join(FIXTURES, "ncaaf-restoration-release-package.json"),
  JSON.stringify(release, null, 2) + "\n",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      sha,
      moneyline: release.markets.moneyline.status,
      spreads: release.markets.spreads.status,
      totals: release.markets.totals.status,
      alts: release.markets.alts.status,
      gates: release.productGates,
    },
    null,
    2,
  ),
);

void DOCS;

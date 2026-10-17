/**
 * One concrete activation/retrieval proposal — no purchase, no collector
 * activation, no fetch, no deploy/OTA/unlock.
 */
import { execSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildInjuryCollectorActivationPackage } from "../src/lib/sportSim/ncaafClean/injuryCollectorActivation.ts";
import { buildScoreTapeProvenanceReport } from "../src/lib/sportSim/ncaafClean/scoreTapeProvenance.ts";
import { buildSpreadsTotalsAltManifest } from "../src/lib/sportSim/ncaafClean/spreadsTotalsAltOddsManifest.ts";
import { snapshotBucketIso } from "../src/lib/ncaafForwardCollector.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const ART = "/opt/cursor/artifacts";

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function minuteBucket(iso: string): string {
  const s = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
  return snapshotBucketIso(s);
}

async function fetchHealth(): Promise<{
  status: number | null;
  body: { data?: { clickhouse?: boolean; status?: string } } | null;
}> {
  try {
    const res = await fetch("https://api.scoretape.com/v1/health", {
      headers: { "User-Agent": "stadium-edge-scoretape-provenance/1.0" },
    });
    const body = (await res.json()) as {
      data?: { clickhouse?: boolean; status?: string };
    };
    return { status: res.status, body };
  } catch {
    return { status: null, body: null };
  }
}

const injury = buildInjuryCollectorActivationPackage();

const espnPath = join(
  FIX,
  "ncaaf-pregame-injury-snapshots/espn-cfb-injuries-2026-10-16T20-06-40-154Z.json",
);
const espnTs = existsSync(espnPath)
  ? (loadJson<{ captureTimestamp: string }>(espnPath).captureTimestamp ?? null)
  : null;

const health = await fetchHealth();
const scoreTape = buildScoreTapeProvenanceReport({
  healthHttpStatus: health.status,
  healthBody: health.body,
  keyPresent: Boolean(String(process.env.SCORETAPE_API_KEY ?? "").trim()),
  espnCaptureTimestamp: espnTs,
});

const membership = loadJson<{
  games: Array<{ eventId: string; kickoffIso: string }>;
}>(join(FIX, "ncaaf-final-eval-membership-games.json")).games;

const h2h = loadJson<{ games: Array<{ gameId: string }> }>(
  join(FIX, "ncaaf-final-eval-close-h2h-archive.json"),
);
const tuning = loadJson<{
  games: Array<{ kickoffIso?: string; closeRequestDate?: string }>;
}>(join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json")).games;

const tuningBuckets = new Set<string>();
for (const g of tuning) {
  const iso = g.closeRequestDate ?? g.kickoffIso;
  if (iso) tuningBuckets.add(minuteBucket(iso));
}

const oddsManifest = buildSpreadsTotalsAltManifest({
  membershipGames: membership,
  h2hArchiveGameIds: h2h.games.map((g) => g.gameId),
  tuningCloseBuckets: tuningBuckets,
  oddsKeyConfigured: Boolean(String(process.env.ODDS_API_KEY ?? "").trim()),
});

const localVsOnDevice = {
  generatedAt: new Date().toISOString(),
  localIntegrationConfirmed: [
    {
      id: "L1",
      suite: "artifacts/api-server/test/ncaafClean.marketGates.test.ts",
      covers: "per-market gates, ATS harness, E4 prospective, diagnosis",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L2",
      suite: "artifacts/api-server/test/ncaafClean.mlOnlyHarness.test.ts",
      covers: "frozen E1 α=1.15; FINAL_EVAL never auto-pass",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L3",
      suite: "artifacts/api-server/test/ncaafClean.e4Availability.test.ts",
      covers: "E4 behavioral policy; null≠false",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L4",
      suite: "artifacts/api-server/test/coachReliability.test.ts",
      covers: "blocked_unvalidated_market digest-only",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L5",
      suite: "artifacts/api-server/test/ncaafPhaseEGates.test.ts",
      covers: "NCAAF_GAME_LINE_SIM_VALIDATED stays false",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L6",
      suite: "artifacts/api-server/test/ncaafForwardCollector.test.ts",
      covers: "credit math, dedupe, activationAllowed",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L7",
      suite: "artifacts/stadium-mobile/lib/ncaafMarketGates.test.ts",
      covers: "P3 family P0 classification",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L8",
      suite: "artifacts/stadium-mobile/lib/ncaafCoachIntegrationPath.test.ts",
      covers: "Coach stage checklist; product closed",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L9",
      suite: "artifacts/stadium-mobile/lib/coach/buildParlay.test.ts",
      covers: "ask-only college P0 exit + short note",
      status: "CONFIRMED_LOCAL",
    },
    {
      id: "L10",
      suite: "injury collector smoke (ACTIVE unset)",
      covers: "script returns INACTIVE JSON without network freeze",
      status: "CONFIRMED_LOCAL",
    },
  ],
  remainingOnDevice: [
    {
      id: "D1",
      check: "Preview iOS ticket with college game-lines ask shows short unavailable copy (not quality-bar)",
      blockedBy: "product gates false — expected empty ticket",
      status: "REMAINING_ON_DEVICE",
    },
    {
      id: "D2",
      check: "College player-props ask still builds when board has props (gates do not block props)",
      blockedBy: "needs live slate + device session",
      status: "REMAINING_ON_DEVICE",
    },
    {
      id: "D3",
      check: "Reliability digest on server shows blocked_unvalidated_market after college ask",
      blockedBy: "needs deployed/server path receiving mobile events",
      status: "REMAINING_ON_DEVICE",
    },
    {
      id: "D4",
      check: "After authorized collector activation: snapshot files appear on runner with captureTimestamp",
      blockedBy: "collector not activated",
      status: "REMAINING_ON_DEVICE",
    },
  ],
  notOnDeviceUntilUnlock: [
    "NCAAF moneyline/spreads/totals graded tickets",
    "E6 gate flip",
    "OTA / production deploy verification of unlock",
  ],
};

let tip = "unknown";
try {
  tip = execSync("git rev-parse HEAD", {
    cwd: join(HERE, "../../.."),
    encoding: "utf8",
  }).trim();
} catch {
  /* ignore */
}

const proposal = {
  title: "NCAAF activation / retrieval proposal",
  generatedAt: new Date().toISOString(),
  branchTip: tip,
  authorizedNow: {
    purchase: false,
    collectorActivation: false,
    oddsFetch: false,
    deploy: false,
    ota: false,
    unlock: false,
  },
  tracks: {
    A_injuryCollector: {
      costUsd: 0,
      ready: true,
      package: injury,
      limits: {
        sampleFloors: injury.sampleFloors,
        expectedWeeks: injury.expectedCollectionPeriod.typicalWeeks,
        freezesPerWeek: injury.schedule.freezesPerWeek,
      },
    },
    B_scoreTapeExplorer: {
      costUsd: 0,
      ready: false,
      needs: "Human Explorer key → SCORETAPE_API_KEY secret",
      provenance: scoreTape,
      limits: {
        historyDays: 7,
        rate: "1 req/s",
        cfbRowsVerified: false,
      },
    },
    C_oddsSpreadsTotals: {
      costUsd: "Odds credits (paid plan) — not spent",
      ready: oddsManifest.featuredSpreadsTotals.creditMath.fitsInHardCap,
      fetchExecuted: false,
      hardCapCredits: oddsManifest.proposedCaps.featuredSpreadsTotalsHardCap,
      basePlusBuffer:
        oddsManifest.featuredSpreadsTotals.creditMath.baseCredits +
        oddsManifest.featuredSpreadsTotals.creditMath.retryBufferCredits,
      markets: oddsManifest.featuredSpreadsTotals.markets,
      nBuckets: oddsManifest.featuredSpreadsTotals.nBucketsToFetch,
      key: oddsManifest.oddsApiKey,
      reuse: oddsManifest.cacheReuse.finalEvalH2hArchive.reuse,
    },
    D_oddsAlternateSpreads: {
      costUsd: "Odds credits — separate cap; not spent",
      ready: false,
      fetchExecuted: false,
      hardCapCredits: oddsManifest.proposedCaps.altSpreadsHardCap,
      basePlusBuffer:
        oddsManifest.alternateSpreads.creditMath.baseCredits +
        oddsManifest.alternateSpreads.creditMath.retryBufferCredits,
      fitsCap: oddsManifest.alternateSpreads.creditMath.fitsInHardCap,
      samplingNote: oddsManifest.alternateSpreads.creditMath.samplingNote,
      deferUntil: "after Track C or explicit ALT authorization",
    },
  },
  recommendedSequence: [
    "1) Authorize Track A: set NCAAF_INJURY_COLLECTOR_ACTIVE=1 on runner + install cron (ACTIVE line uncommented)",
    "2) Parallel Track B: human requests ScoreTape Explorer key; store SCORETAPE_API_KEY; verify CFB captured_ms",
    "3) When spreads/totals evidence needed: authorize Track C only (cap 4200, markets=spreads,totals, reuse h2h archive)",
    "4) Defer Track D ALTs unless separate cap/sample approved",
    "5) Keep all product gates false; no deploy/OTA/unlock",
  ],
  costsAndLimits: {
    thisTurnUsd: 0,
    trackA_usd: 0,
    trackB_usd: 0,
    trackC_credits_cap: 4200,
    trackC_credits_estimated:
      oddsManifest.featuredSpreadsTotals.creditMath.baseCredits +
      oddsManifest.featuredSpreadsTotals.creditMath.retryBufferCredits,
    trackD_credits_cap: 4200,
    trackD_credits_estimated_full:
      oddsManifest.alternateSpreads.creditMath.baseCredits +
      oddsManifest.alternateSpreads.creditMath.retryBufferCredits,
    frozenMlUnchanged: true,
  },
  localVsOnDevice,
  oddsManifestSummary: {
    id: oddsManifest.featuredSpreadsTotals.id,
    altId: oddsManifest.alternateSpreads.id,
    provider: oddsManifest.provider.name,
    featuredFitsCap: oddsManifest.featuredSpreadsTotals.creditMath.fitsInHardCap,
    altFitsCap: oddsManifest.alternateSpreads.creditMath.fitsInHardCap,
  },
};

// Persist fixtures (full odds manifest separate — large requests array)
writeFileSync(
  join(FIX, "ncaaf-injury-collector-activation.json"),
  `${JSON.stringify(injury, null, 2)}\n`,
);
writeFileSync(
  join(FIX, "ncaaf-scoretape-provenance.json"),
  `${JSON.stringify(scoreTape, null, 2)}\n`,
);
writeFileSync(
  join(FIX, "ncaaf-spreads-totals-alt-odds-manifest.json"),
  `${JSON.stringify(oddsManifest, null, 2)}\n`,
);
writeFileSync(
  join(FIX, "ncaaf-local-vs-on-device-checks.json"),
  `${JSON.stringify(localVsOnDevice, null, 2)}\n`,
);
writeFileSync(
  join(FIX, "ncaaf-activation-retrieval-proposal.json"),
  `${JSON.stringify(proposal, null, 2)}\n`,
);

try {
  chmodSync(join(HERE, "ncaafInjuryCollectorCron.sh"), 0o755);
} catch {
  /* ignore */
}

for (const dir of [ART, FIX]) {
  try {
    writeFileSync(
      join(dir === ART ? ART : FIX, "ncaaf-activation-retrieval-proposal.json"),
      `${JSON.stringify(proposal, null, 2)}\n`,
    );
  } catch {
    /* ART may be missing in some envs */
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      tip,
      injuryStatus: injury.status,
      scoreTapeVerdict: scoreTape.verdict,
      featuredCredits:
        oddsManifest.featuredSpreadsTotals.creditMath.baseCredits +
        oddsManifest.featuredSpreadsTotals.creditMath.retryBufferCredits,
      featuredCap: oddsManifest.proposedCaps.featuredSpreadsTotalsHardCap,
      featuredFits: oddsManifest.featuredSpreadsTotals.creditMath.fitsInHardCap,
      altCredits:
        oddsManifest.alternateSpreads.creditMath.baseCredits +
        oddsManifest.alternateSpreads.creditMath.retryBufferCredits,
      altFits: oddsManifest.alternateSpreads.creditMath.fitsInHardCap,
      localConfirmed: localVsOnDevice.localIntegrationConfirmed.length,
      onDeviceRemaining: localVsOnDevice.remainingOnDevice.length,
    },
    null,
    2,
  ),
);

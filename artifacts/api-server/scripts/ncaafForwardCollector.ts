/**
 * NCAAF forward collector CLI — prepare / dry-run only by default.
 *
 * Env:
 *   NCAAF_FORWARD_ACTIVATE=1     — required to perform paid Odds calls (refuse otherwise)
 *   NCAAF_FORWARD_CREDIT_CAP=N   — hard credit budget for this process
 *   ODDS_API_KEY                 — same secret as api-server odds routes (never logged)
 *   NCAAF_FORWARD_DRY_RUN=1      — force dry-run even if activate is set (default behavior
 *                                  when activate unset)
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED. No deploy/OTA.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NCAAF_FORWARD_DEFAULT_SCHEDULE,
  NCAAF_FORWARD_FEATURED_MARKETS,
  NCAAF_FORWARD_REGIONS_LIVE,
  NCAAF_FORWARD_SPORT,
  activationAllowed,
  buildSnapshotMeta,
  createCreditLedger,
  estimateWeeklyCredits,
  historicalHeavyWeeklyEstimate,
  type SnapshotMeta,
} from "../src/lib/ncaafForwardCollector.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "../test/fixtures/ncaaf-forward-odds");
const MANIFEST = join(OUT_DIR, "manifest.json");
const ART = "/opt/cursor/artifacts";

type Manifest = {
  version: 1;
  activatedEver: false;
  dedupeKeys: string[];
  snapshots: Array<{
    file: string;
    captureTimestamp: string;
    dedupeKey: string;
    mode: string;
    creditsCharged: number;
    eventCount: number;
  }>;
  weeklyCostModel: ReturnType<typeof estimateWeeklyCredits>;
  historicalHeavyReconcile: ReturnType<typeof historicalHeavyWeeklyEstimate>;
  activationSteps: string[];
};

function loadManifest(): Manifest {
  if (existsSync(MANIFEST)) {
    return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  }
  return {
    version: 1,
    activatedEver: false,
    dedupeKeys: [],
    snapshots: [],
    weeklyCostModel: estimateWeeklyCredits(NCAAF_FORWARD_DEFAULT_SCHEDULE),
    historicalHeavyReconcile: historicalHeavyWeeklyEstimate(),
    activationSteps: [
      "Inject ODDS_API_KEY as the same Cursor/Render secret used by api-server odds routes (never paste into chat)",
      "Set NCAAF_FORWARD_CREDIT_CAP to a finite budget (e.g. 100 for first live smoke)",
      "Review docs/coach/ncaaf-forward-collection-plan.md cost table",
      "Set NCAAF_FORWARD_ACTIVATE=1 only after human approval",
      "Run collector once; confirm dedupe + ledger; do not deploy/OTA",
      "Keep NCAAF_GAME_LINE_SIM_VALIDATED=false",
    ],
  };
}

function main(): number {
  console.log("══ NCAAF forward collector (prepare / dry-run) ══");
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped.");
  console.log("Paid Odds retrieval is NOT performed unless activation gates pass.");

  const oddsConfigured = Boolean(String(process.env.ODDS_API_KEY ?? "").trim());
  const gate = activationAllowed();
  const weekly = estimateWeeklyCredits();
  const heavy = historicalHeavyWeeklyEstimate();
  const captureTimestamp = new Date().toISOString();

  const meta = buildSnapshotMeta({
    captureTimestamp,
    mode: "dry_run",
    markets: NCAAF_FORWARD_FEATURED_MARKETS,
    regions: NCAAF_FORWARD_REGIONS_LIVE,
    creditsCharged: 0,
    eventCount: 0,
    oddsKeyConfigured: oddsConfigured,
  });

  const manifest = loadManifest();
  // Refresh cost model each prepare run
  manifest.weeklyCostModel = weekly;
  manifest.historicalHeavyReconcile = heavy;
  manifest.activatedEver = false;

  if (manifest.dedupeKeys.includes(meta.dedupeKey)) {
    console.log("dedupe: snapshot bucket already recorded — skip write");
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
    const file = `dry-run-${captureTimestamp.replace(/[:.]/g, "-")}.json`;
    const payload = {
      ...meta,
      sportKey: NCAAF_FORWARD_SPORT,
      note: "Dry-run placeholder. No Odds API response body. Key never stored.",
      events: [] as unknown[],
    };
    writeFileSync(join(OUT_DIR, file), `${JSON.stringify(payload, null, 2)}\n`);
    manifest.dedupeKeys.push(meta.dedupeKey);
    manifest.snapshots.push({
      file,
      captureTimestamp: meta.captureTimestamp,
      dedupeKey: meta.dedupeKey,
      mode: meta.mode,
      creditsCharged: 0,
      eventCount: 0,
    });
  }

  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  // Demonstrate ledger without spending (cap from env or illustrative 0)
  const capEnv = Number(process.env.NCAAF_FORWARD_CREDIT_CAP ?? 0);
  const ledger = createCreditLedger(Number.isFinite(capEnv) && capEnv > 0 ? capEnv : 0);

  const report = {
    preparedAt: captureTimestamp,
    activation: gate,
    credential: meta.credential,
    creditLedger: ledger,
    weeklyCostDefaultLive: weekly,
    weeklyCostHistoricalHeavyReconcile: heavy,
    priorEstimateNote:
      "Earlier 300–800 credits/week assumed ~10–20 historical featured buckets/week (10× markets×regions). Default forward schedule uses LIVE featured polls (~16×3=48 credits/week) with historical/ALT off until authorized.",
    snapshot: meta as SnapshotMeta,
    outDir: OUT_DIR,
    keepP0Armed: true,
    flagFlipAllowed: false,
    paidRetrievalPerformed: false,
  };

  try {
    mkdirSync(ART, { recursive: true });
    writeFileSync(
      join(ART, "ncaaf-forward-collector-prepare.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch {
    /* optional */
  }

  console.log(JSON.stringify(report, null, 2));

  if (gate.allowed) {
    console.error(
      "Activation gates are set, but this prepare script still refuses paid fetch. Use a dedicated activate runner after explicit approval.",
    );
    return 2;
  }
  return 0;
}

process.exit(main());

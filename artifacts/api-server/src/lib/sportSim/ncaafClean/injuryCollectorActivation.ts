/**
 * $0 forward ESPN injury collector — activation package.
 * Frozen M_base / product gates unchanged. No paid APIs.
 */

export const INJURY_COLLECTOR_ENV = {
  activeFlag: "NCAAF_INJURY_COLLECTOR_ACTIVE",
  activeValue: "1",
  outDir: "NCAAF_INJURY_SNAPSHOT_DIR",
} as const;

export const INJURY_COLLECTOR_PATHS = {
  script: "artifacts/api-server/scripts/ncaafPregameInjurySnapshotCollector.ts",
  /** Durable store (gitignored). Fixtures keep a sample pointer only. */
  durableOutDir: "artifacts/api-server/var/ncaaf-injury-snapshots/",
  fixtureSampleDir:
    "artifacts/api-server/test/fixtures/ncaaf-pregame-injury-snapshots/",
  manifest: "manifest.json",
  failures: "failures.jsonl",
  snapshotsSubdir: "snapshots/",
  runner: "artifacts/api-server/scripts/ncaafInjuryCollectorCron.sh",
  unitFile: "artifacts/api-server/scripts/ncaaf-injury-collector.cron",
} as const;

export const INJURY_SAMPLE_FLOORS = {
  N1_minDecidedCloseMlWithJoinAttempt: 60,
  N2_minInjuryKnownTrue: 20,
  N3_minInjuryKnownNull: 20,
  N4_minHome: 15,
  N4_minAway: 15,
  N5_captureBeforeKickoff: true,
  N6_neverCoerceNullToFalse: true,
} as const;

/**
 * Corrected schedule (UTC):
 * Mon–Thu 2×/day → 8; Fri–Sun 4×/day → 12; **total 20 freezes/week**.
 * (Prior package incorrectly labeled this as 14.)
 */
export const INJURY_COLLECTOR_SCHEDULE = {
  timezone: "UTC",
  crontab: ["0 14,22 * * 1-4", "0 2,14,18,22 * * 5-7"],
  freezesPerWeek: 20,
  monThuPerDay: 2,
  friSunPerDay: 4,
  monThuDays: 4,
  friSunDays: 3,
  math: "4×2 + 3×4 = 20",
  costUsdPerWeek: 0,
  source: "espn_site_api_college_football_injuries",
} as const;

export const INJURY_COLLECTION_PERIOD = {
  typicalWeeks: [3, 6] as const,
  aggressiveWeeks: [2, 3] as const,
  freezesPerWeek: 20,
  note:
    "Odds-listed FBS only; pre-schedule 25–35% null holdout before week starts; stop when N1–N3 met and membership frozen",
} as const;

export type InjuryActivationPackage = {
  status: "ACTIVE" | "PREPARED_INACTIVE";
  activated: boolean;
  frozenMlUnchanged: true;
  productGatesUnchanged: true;
  env: typeof INJURY_COLLECTOR_ENV;
  paths: typeof INJURY_COLLECTOR_PATHS;
  schedule: typeof INJURY_COLLECTOR_SCHEDULE;
  storage: {
    root: string;
    snapshotsSubdir: string;
    manifest: string;
    failures: string;
    dedupe: string[];
    gitPolicy: string;
  };
  sampleFloors: typeof INJURY_SAMPLE_FLOORS;
  expectedCollectionPeriod: typeof INJURY_COLLECTION_PERIOD;
  deploymentDiff: {
    filesToAdd: string[];
    envToSet: Record<string, string>;
    cronInstall: string[];
    activateCommand: string;
    deactivateCommand: string;
  };
  holds: string[];
};

export function buildInjuryCollectorActivationPackage(opts?: {
  activated?: boolean;
}): InjuryActivationPackage {
  const activated = opts?.activated === true;
  return {
    status: activated ? "ACTIVE" : "PREPARED_INACTIVE",
    activated,
    frozenMlUnchanged: true,
    productGatesUnchanged: true,
    env: INJURY_COLLECTOR_ENV,
    paths: INJURY_COLLECTOR_PATHS,
    schedule: INJURY_COLLECTOR_SCHEDULE,
    storage: {
      root: INJURY_COLLECTOR_PATHS.durableOutDir,
      snapshotsSubdir: INJURY_COLLECTOR_PATHS.snapshotsSubdir,
      manifest: INJURY_COLLECTOR_PATHS.manifest,
      failures: INJURY_COLLECTOR_PATHS.failures,
      dedupe: [
        "skip if same UTC minuteBucketIso already stored",
        "skip if identical contentSha256 already stored",
      ],
      gitPolicy:
        "Durable store under var/ is gitignored; never rewrite past labels; never backfill TUNING/FINAL_EVAL; never join into frozen M_base",
    },
    sampleFloors: INJURY_SAMPLE_FLOORS,
    expectedCollectionPeriod: INJURY_COLLECTION_PERIOD,
    deploymentDiff: {
      filesToAdd: [
        INJURY_COLLECTOR_PATHS.runner,
        INJURY_COLLECTOR_PATHS.unitFile,
      ],
      envToSet: {
        [INJURY_COLLECTOR_ENV.activeFlag]: INJURY_COLLECTOR_ENV.activeValue,
        [INJURY_COLLECTOR_ENV.outDir]: INJURY_COLLECTOR_PATHS.durableOutDir,
      },
      cronInstall: [
        `crontab -l 2>/dev/null | grep -v ncaafInjuryCollectorCron | { cat; cat ${INJURY_COLLECTOR_PATHS.unitFile}; } | crontab -`,
      ],
      activateCommand:
        `cd artifacts/api-server && NCAAF_INJURY_COLLECTOR_ACTIVE=1 ` +
        `NCAAF_INJURY_SNAPSHOT_DIR=./var/ncaaf-injury-snapshots ` +
        `node --import ./test/register-hooks.mjs ./scripts/ncaafPregameInjurySnapshotCollector.ts`,
      deactivateCommand:
        "Remove cron lines; unset NCAAF_INJURY_COLLECTOR_ACTIVE",
    },
    holds: [
      "Product gates stay false — no NCAAF unlock",
      "Frozen ML M_base unchanged — no injury adjust on FINAL_EVAL",
      "No Odds fetch / no paid purchase / no mobile OTA",
      "ALTs deferred · voice paused",
    ],
  };
}

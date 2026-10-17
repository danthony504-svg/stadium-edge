/**
 * $0 forward ESPN injury collector — activation package (not activated).
 * Frozen M_base / predictE1Frozen unchanged. No paid APIs.
 */

export const INJURY_COLLECTOR_ENV = {
  activeFlag: "NCAAF_INJURY_COLLECTOR_ACTIVE",
  activeValue: "1",
  /** Optional: override output dir (default fixtures path). */
  outDir: "NCAAF_INJURY_SNAPSHOT_DIR",
} as const;

export const INJURY_COLLECTOR_PATHS = {
  script: "artifacts/api-server/scripts/ncaafPregameInjurySnapshotCollector.ts",
  defaultOutDir:
    "artifacts/api-server/test/fixtures/ncaaf-pregame-injury-snapshots/",
  manifest: "manifest.json",
  runner: "artifacts/api-server/scripts/ncaafInjuryCollectorCron.sh",
  unitFile: "artifacts/api-server/scripts/ncaaf-injury-collector.cron",
} as const;

/** Locked sample floors (same as E4 prospective criteria). */
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
 * Cron schedule (UTC): dense around FBS tip windows.
 * Mon–Thu 2×/day; Fri–Sun 4×/day → 14 freezes/week.
 */
export const INJURY_COLLECTOR_SCHEDULE = {
  timezone: "UTC",
  /** Mon–Thu 14:00+22:00; Fri–Sun 02:00+14:00+18:00+22:00 UTC */
  crontab: ["0 14,22 * * 1-4", "0 2,14,18,22 * * 5-7"],
  freezesPerWeek: 14,
  costUsdPerWeek: 0,
  source: "espn_site_api_college_football_injuries",
} as const;

/** Expected collection to hit N1–N3 in-season. */
export const INJURY_COLLECTION_PERIOD = {
  typicalWeeks: [3, 6] as const,
  aggressiveWeeks: [2, 3] as const,
  note:
    "Odds-listed FBS only; pre-schedule 25–35% null holdout before week starts; stop when N1–N3 met and membership frozen",
} as const;

export type InjuryActivationPackage = {
  status: "PREPARED_INACTIVE";
  activated: false;
  frozenMlUnchanged: true;
  env: typeof INJURY_COLLECTOR_ENV;
  paths: typeof INJURY_COLLECTOR_PATHS;
  schedule: typeof INJURY_COLLECTOR_SCHEDULE;
  storage: {
    root: string;
    snapshotGlob: string;
    manifest: string;
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
    smokeInactiveCommand: string;
  };
  holds: string[];
};

export function buildInjuryCollectorActivationPackage(): InjuryActivationPackage {
  return {
    status: "PREPARED_INACTIVE",
    activated: false,
    frozenMlUnchanged: true,
    env: INJURY_COLLECTOR_ENV,
    paths: INJURY_COLLECTOR_PATHS,
    schedule: INJURY_COLLECTOR_SCHEDULE,
    storage: {
      root: INJURY_COLLECTOR_PATHS.defaultOutDir,
      snapshotGlob: "espn-cfb-injuries-*.json",
      manifest: INJURY_COLLECTOR_PATHS.manifest,
      gitPolicy:
        "Commit snapshots + manifest on collector host or sync to fixtures; never rewrite past kickoff labels; never backfill TUNING/FINAL_EVAL",
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
      },
      cronInstall: [
        `# install (human, after approval):`,
        `crontab -l 2>/dev/null | cat - ${INJURY_COLLECTOR_PATHS.unitFile} | crontab -`,
        `# or: sudo cp ${INJURY_COLLECTOR_PATHS.unitFile} /etc/cron.d/ncaaf-injury-collector`,
      ],
      activateCommand:
        `cd artifacts/api-server && NCAAF_INJURY_COLLECTOR_ACTIVE=1 ` +
        `node --import ./test/register-hooks.mjs ./scripts/ncaafPregameInjurySnapshotCollector.ts`,
      deactivateCommand: `unset NCAAF_INJURY_COLLECTOR_ACTIVE  # and remove cron lines`,
      smokeInactiveCommand:
        `cd artifacts/api-server && node --import ./test/register-hooks.mjs ./scripts/ncaafPregameInjurySnapshotCollector.ts`,
    },
    holds: [
      "Do not set NCAAF_INJURY_COLLECTOR_ACTIVE until human authorization",
      "Do not flip NCAAF_GAME_LINE_SIM_VALIDATED / per-market gates",
      "Do not apply e4ConservativeAdjust to frozen FINAL_EVAL M_base",
      "No deploy / OTA required — offline cron on a runner with repo checkout",
    ],
  };
}

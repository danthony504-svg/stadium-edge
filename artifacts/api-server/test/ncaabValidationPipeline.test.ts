import test from "node:test";
import assert from "node:assert/strict";
import {
  ncaabResearchSlot,
  runNcaabValidationPipeline,
  NCAAB_MIN_INDEPENDENT_GAMES,
  NCAAB_MIN_SEASONS,
} from "../src/lib/ncaabValidationPipeline.js";
import { ncaabPipelineReadiness } from "../src/lib/ncaabPipelineReadiness.js";

const kickoff = "2026-10-20T00:00:00.000Z";

function sampleForecast() {
  return {
    researchOnly: true,
    modelVersion: "ncaab-research-fixture-v1",
    recordedAt: "2026-10-19T18:00:00.000Z",
    forecastAt: "2026-10-19T17:00:00.000Z",
    inputCutoffAt: "2026-10-19T17:00:00.000Z",
    datasetRole: "independent_holdout",
    target: {
      eventId: "401900001",
      season: 2027,
      homeId: "150",
      awayId: "151",
      kickoff,
      ruleset: "full_game_including_overtime",
    },
    markets: [
      {
        bookmaker: "draftkings",
        market: "ml",
        line: null,
        firstPrice: -120,
        secondPrice: 100,
        conditionalWinProbability: 0.6,
      },
    ],
  };
}

function fixture(nowIso = "2026-10-26T17:30:00.000Z") {
  const values = new Map<string, any>();
  const pendingRows: any[] = [];
  const db = {
    now: nowIso,
    values,
    pendingRows,
    unlocks: 0,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("current_database()"))
        return { rows: [{ name: "stadium_edge_production" }] };
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) {
        db.unlocks++;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      if (sql.includes("AS forecasts"))
        return {
          rows: [
            {
              forecasts: [...values.keys()].filter((k) =>
                k.startsWith("research:ncaab:forecast:"),
              ).length,
              settlements: [...values.keys()].filter((k) =>
                k.startsWith("research:ncaab:settlement:"),
              ).length,
              live_archives: 0,
              independent_holdout_forecasts: 0,
              future_holdout_contexts: 0,
              prior_season_forecasts: 0,
              now: db.now,
            },
          ],
        };
      if (sql.includes("SELECT clock_timestamp() AS now"))
        return { rows: [{ now: db.now }] };
      if (sql.includes("SELECT value FROM public.app_kv WHERE key=$1")) {
        const key = String(params?.[0]);
        return { rows: values.has(key) ? [{ value: values.get(key) }] : [] };
      }
      if (sql.includes("ON CONFLICT(key) DO NOTHING RETURNING key")) {
        const key = String(params?.[0]);
        if (values.has(key)) return { rows: [], rowCount: 0 };
        values.set(key, JSON.parse(String(params?.[1])));
        return { rows: [{ key }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO public.app_kv")) {
        const key = String(params?.[0]);
        const value = JSON.parse(String(params?.[1]));
        values.set(key, value);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("research:ncaab:forecast:%"))
        return { rows: pendingRows.slice() };
      if (sql.includes("key=ANY")) {
        const keys = (params?.[0] as string[]) ?? [];
        return {
          rows: keys
            .filter((k) => values.has(k))
            .map((k) => ({ key: k, value: values.get(k) })),
        };
      }
      if (sql.includes("live-inputs:")) return { rows: [] };
      return { rows: [] };
    },
  };
  return { db };
}

const noOutcome = async () => null;

test("ncaab research slots align to UTC research hours", () => {
  assert.equal(
    ncaabResearchSlot(new Date("2026-10-26T17:30:00Z")),
    "2026-10-26T14:00:00.000Z",
  );
  assert.equal(NCAAB_MIN_INDEPENDENT_GAMES, 500);
  assert.equal(NCAAB_MIN_SEASONS, 2);
});

test("NCAAB pipeline never enables Coach and skips without odds credentials", async () => {
  const { db } = fixture();
  const r = await runNcaabValidationPipeline({
    db,
    collectionEnabled: false,
    fetchOutcome: noOutcome,
    runCollector: async () => {
      throw Error("must not collect");
    },
  });
  assert.equal(r.state, "skipped_missing_odds_credentials");
  assert.equal(r.releaseEligible, false);
  assert.equal(r.coachEnabled, false);
  assert.equal(db.unlocks, 1);
});

test("NCAAB collection records waiting_for_frozen_candidate without inventing forecasts", async () => {
  const { db } = fixture();
  const calls: string[] = [];
  const r = await runNcaabValidationPipeline({
    db,
    collectionEnabled: true,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => ({
      state: "waiting_for_verified_development_finals",
      modelSha256: null,
    }),
    runCollector: async (name) => {
      calls.push(name);
    },
  });
  assert.equal(r.state, "processed");
  assert.equal(r.releaseEligible, false);
  assert.equal(r.coachEnabled, false);
  assert.deepEqual(calls, [
    "ncaab-capture-live-inputs.mjs",
    "ncaab-prepare-development.mjs",
  ]);
  const latest = db.values.get("research:ncaab:pipeline:latest");
  assert.equal(latest.freezeState, "waiting_for_verified_development_finals");
  assert.equal(latest.freezeModelSha256, null);
  assert.equal(latest.blockers.waiting_for_verified_development_finals, 1);
  assert.equal(latest.blockers.waiting_for_frozen_ncaab_candidate, 1);
  assert.equal(
    [...db.values.keys()].some((k) => k.startsWith("research:ncaab:forecast:")),
    false,
  );
});

test("completed NCAAB slot does not re-charge odds", async () => {
  const { db } = fixture();
  await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    runCollector: async () => {},
  });
  const again = await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => ({
      state: "waiting_for_verified_development_finals",
      modelSha256: null,
    }),
    runCollector: async (name) => {
      if (name === "ncaab-capture-live-inputs.mjs")
        throw Error("must not collect odds again");
    },
  });
  assert.equal(again.state, "skipped_completed_slot");
  assert.equal(again.releaseEligible, false);
});

test("completed NCAAB slot still prepares, freezes, and journals without paid odds", async () => {
  const { db } = fixture();
  const freezeCalls: string[] = [];
  const journalCalls: number[] = [];
  const collectors: string[] = [];

  // First pass charges odds once and completes the slot.
  await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => {
      freezeCalls.push("first");
      return { state: "waiting_for_verified_development_finals", modelSha256: null };
    },
    recordJournal: async () => {
      journalCalls.push(0);
      return { state: "waiting_for_frozen_ncaab_candidate", recorded: 0 };
    },
    runCollector: async (name) => {
      collectors.push(`first:${name}`);
    },
  });
  assert.ok(collectors.includes("first:ncaab-capture-live-inputs.mjs"));
  assert.ok(collectors.includes("first:ncaab-prepare-development.mjs"));

  // Simulate prepare writing authenticated development counts mid-slot.
  db.values.set("research:ncaab:development-dataset:latest", {
    state: "prepared",
    authenticatedDevelopmentGames: 4,
    featureCompleteGames: 3,
    manifestSha256: "a".repeat(64),
    holdoutEligible: false,
  });
  // Expire maintenance cadence without crossing into the next research slot.
  db.now = "2026-10-26T17:55:00.000Z";
  for (const key of [...db.values.keys()]) {
    if (key.startsWith("research:ncaab:pipeline:maintenance:"))
      db.values.delete(key);
  }

  const maintenanceCollectors: string[] = [];
  const again = await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => {
      freezeCalls.push("maintenance");
      return {
        state: "waiting_for_more_development_games",
        modelSha256: null,
      };
    },
    recordJournal: async () => {
      journalCalls.push(1);
      return { state: "processed", recorded: 0, withheld: 0 };
    },
    runCollector: async (name) => {
      if (name === "ncaab-capture-live-inputs.mjs")
        throw Error("must not re-charge odds on completed slot");
      maintenanceCollectors.push(name);
    },
  });

  assert.equal(again.state, "skipped_completed_slot");
  assert.equal((again as any).maintenanceRan, true);
  assert.deepEqual(maintenanceCollectors, ["ncaab-prepare-development.mjs"]);
  assert.ok(freezeCalls.includes("maintenance"));
  assert.equal((again as any).freezeModelSha256, null);
  assert.equal((again as any).authenticatedDevelopmentGames, 4);
  assert.equal((again as any).featureCompleteDevelopmentGames, 3);
  assert.equal((again as any).freezeState, "waiting_for_more_development_games");
  assert.equal(again.releaseEligible, false);
  assert.equal(again.coachEnabled, false);

  const latest = db.values.get("research:ncaab:pipeline:latest");
  assert.equal(latest.paidCollectionSkipped, true);
  assert.equal(latest.freezeModelSha256, null);
  assert.equal(latest.authenticatedDevelopmentGames, 4);
  assert.equal(
    latest.blockers.waiting_for_more_development_games,
    1,
  );
  // Journal is not invoked without a frozen candidate hash.
  assert.equal(journalCalls.includes(1), false);

  // Cadence: immediate re-entry must not re-run maintenance collectors.
  const thirdCollectors: string[] = [];
  const third = await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => {
      throw Error("must not freeze inside maintenance cadence");
    },
    runCollector: async (name) => {
      thirdCollectors.push(name);
    },
  });
  assert.equal(third.state, "skipped_completed_slot");
  assert.equal((third as any).maintenanceSkippedCadence, true);
  assert.deepEqual(thirdCollectors, []);
});

test("maintenance errors never demote a completed paid slot or reopen odds", async () => {
  const { db } = fixture();
  await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => ({
      state: "waiting_for_verified_development_finals",
      modelSha256: null,
    }),
    runCollector: async () => {},
  });
  const slotKey = [...db.values.keys()].find((k) =>
    k.startsWith("research:ncaab:pipeline:slot:"),
  );
  assert.ok(slotKey);
  const completed = db.values.get(slotKey!);
  assert.equal(completed.state, "processed");
  assert.equal(completed.oddsAttempted, true);
  assert.ok(completed.finishedAt);

  db.now = "2026-10-26T17:55:00.000Z";
  for (const key of [...db.values.keys()]) {
    if (key.startsWith("research:ncaab:pipeline:maintenance:"))
      db.values.delete(key);
  }

  // Uncaught storage fault during maintenance (collectors/freeze are fail-soft).
  const innerQuery = db.query.bind(db);
  let armed = false;
  db.query = async (sql: string, params?: unknown[]) => {
    if (
      armed &&
      sql.includes("SELECT value FROM public.app_kv WHERE key=$1") &&
      String(params?.[0]) === "research:ncaab:development-dataset:latest"
    )
      throw Error("boom_maintenance");
    return innerQuery(sql, params);
  };

  armed = true;
  await assert.rejects(
    () =>
      runNcaabValidationPipeline({
        db,
        fetchOutcome: noOutcome,
        attemptFreeze: async () => ({
          state: "waiting_for_more_development_games",
          modelSha256: null,
        }),
        runCollector: async (name) => {
          if (name === "ncaab-capture-live-inputs.mjs")
            throw Error("must not re-charge odds");
        },
      }),
    /boom_maintenance/,
  );

  const after = db.values.get(slotKey!);
  assert.equal(after.state, "processed");
  assert.equal(after.oddsAttempted, true);
  assert.equal(after.finishedAt, completed.finishedAt);
  assert.equal(after.attempts, completed.attempts);
  assert.equal(after.lastMaintenanceState, "failed");
  assert.equal(after.lastMaintenanceReason, "boom_maintenance");
  const latest = db.values.get("research:ncaab:pipeline:latest");
  assert.equal(latest.state, "failed");
  assert.equal(latest.reason, "boom_maintenance");
  const maintenance = [...db.values.entries()].find(([k]) =>
    k.startsWith("research:ncaab:pipeline:maintenance:"),
  );
  assert.ok(maintenance);
  assert.equal(maintenance![1].state, "failed");
  assert.equal(maintenance![1].reason, "boom_maintenance");

  // Immediate retry must hit the 30m maintenance cadence, not loop.
  armed = false;
  const thirdCollectors: string[] = [];
  const third = await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => {
      throw Error("must not freeze inside failed-maintenance cadence");
    },
    runCollector: async (name) => {
      thirdCollectors.push(name);
    },
  });
  assert.equal(third.state, "skipped_completed_slot");
  assert.equal((third as any).maintenanceSkippedCadence, true);
  assert.deepEqual(thirdCollectors, []);
});

test("completed-slot maintenance journals when a frozen candidate already exists", async () => {
  const { db } = fixture();
  await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => ({
      state: "frozen_research_candidate",
      modelSha256: "b".repeat(64),
    }),
    recordJournal: async () => ({ state: "processed", recorded: 0 }),
    runCollector: async () => {},
  });
  db.values.set("research:ncaab:adjusted-model:latest", {
    state: "frozen_research_candidate",
    modelSha256: "b".repeat(64),
  });
  db.values.set("research:ncaab:development-dataset:latest", {
    state: "prepared",
    authenticatedDevelopmentGames: 9,
    featureCompleteGames: 9,
  });
  // Expire maintenance cadence without leaving the 14:00 UTC research slot.
  db.now = "2026-10-26T17:55:00.000Z";
  for (const key of [...db.values.keys()]) {
    if (key.startsWith("research:ncaab:pipeline:maintenance:"))
      db.values.delete(key);
  }

  let journaled = false;
  const again = await runNcaabValidationPipeline({
    db,
    fetchOutcome: noOutcome,
    attemptFreeze: async () => ({
      state: "frozen_candidate_preserved",
      modelSha256: "b".repeat(64),
    }),
    recordJournal: async () => {
      journaled = true;
      return { state: "processed", recorded: 2, withheld: 1 };
    },
    runCollector: async (name) => {
      if (name === "ncaab-capture-live-inputs.mjs")
        throw Error("must not re-charge odds");
    },
  });
  assert.equal(again.state, "skipped_completed_slot");
  assert.equal(journaled, true);
  assert.equal((again as any).freezeModelSha256, "b".repeat(64));
  const latest = db.values.get("research:ncaab:pipeline:latest");
  assert.equal(latest.journalRecorded, 2);
  assert.equal(latest.journalWithheld, 1);
});

test("NCAAB settlement scores authenticated finals without enabling Coach", async () => {
  const { db } = fixture("2026-10-20T08:00:00.000Z");
  const forecastKey = "research:ncaab:forecast:401900001:ncaab-research-fixture-v1";
  const forecast = sampleForecast();
  db.values.set(forecastKey, forecast);
  db.pendingRows.push({ key: forecastKey, value: forecast });

  const result = await runNcaabValidationPipeline({
    db,
    settlementOnly: true,
    fetchOutcome: async () => ({
      outcome: {
        eventId: "401900001",
        season: 2027,
        homeId: "150",
        awayId: "151",
        kickoff,
        homePoints: 78,
        awayPoints: 70,
        ruleset: "full_game_including_overtime",
      },
      source: { fixture: true },
    }),
    runCollector: async () => {
      throw Error("must not collect during settlement-only");
    },
  });

  assert.equal(result.state, "settlement_check_completed");
  assert.equal(result.settlementsRecorded, 1);
  assert.equal(result.releaseEligible, false);
  assert.equal(result.coachEnabled, false);
  const settlement = db.values.get(
    "research:ncaab:settlement:401900001:ncaab-research-fixture-v1",
  );
  assert.equal(settlement.releaseEligible, false);
  assert.equal(settlement.metrics[0].result, "win");
  assert.equal(
    db.values.get("research:ncaab:settlement-check:latest").settlementsRecorded,
    1,
  );
  assert.equal(
    db.values.get("research:ncaab:settlement-check:latest").note,
    undefined,
  );
});

test("NCAAB settlement leaves forecasts unsettled when final is unavailable", async () => {
  const { db } = fixture("2026-10-20T08:00:00.000Z");
  const forecastKey = "research:ncaab:forecast:401900001:pending";
  const forecast = sampleForecast();
  db.pendingRows.push({ key: forecastKey, value: forecast });
  const result = await runNcaabValidationPipeline({
    db,
    settlementOnly: true,
    fetchOutcome: async () => null,
    runCollector: async () => {
      throw Error("must not collect");
    },
  });
  assert.equal(result.settlementsRecorded, 0);
  assert.equal(result.unsettledInBatch, 1);
  assert.equal(
    [...db.values.keys()].some((k) =>
      k.startsWith("research:ncaab:settlement:"),
    ),
    false,
  );
});

test("NCAAB readiness stays BLOCKED with separate inventory", async () => {
  const { db } = fixture();
  const report = await ncaabPipelineReadiness(db);
  assert.equal(report.sport, "ncaab");
  assert.equal(report.coachEnabled, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.inheritsNcaafArtifacts, false);
  assert.equal(report.coachEnablementDecision.decision, "BLOCKED");
  assert.equal(report.coachEnablementDecision.researchPipelineExists, true);
  assert.ok(
    report.coachEnablementDecision.unmet.some((u) =>
      u.includes("independent_holdout_forecasts=0"),
    ),
  );
});

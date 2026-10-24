import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildLiveArchive } from "../../../scripts/ncaaf-capture-live-inputs.mjs";
import {
  researchSlot,
  runNcaafValidationPipeline,
  calibrationReport,
  type ResearchDb,
} from "../src/lib/ncaafValidationPipeline.js";
class Store implements ResearchDb {
  values = new Map<string, any>();
  now = "2026-10-23T14:05:00Z";
  lock = true;
  unlocks = 0;
  lateWrite = false;
  async query(sql: string, p: unknown[] = []) {
    if (sql.includes("current_database"))
      return { rows: [{ name: "stadium_edge_production" }] };
    if (sql.includes("clock_timestamp() AS now"))
      return { rows: [{ now: this.now }] };
    if (sql.includes("pg_try_advisory_lock"))
      return { rows: [{ acquired: this.lock }] };
    if (sql.includes("pg_advisory_unlock")) {
      this.unlocks++;
      return { rows: [] };
    }
    if (sql.startsWith("SELECT value FROM public.app_kv WHERE key=$1")) {
      const v = this.values.get(String(p[0]));
      return { rows: v ? [{ value: structuredClone(v) }] : [] };
    }
    if (sql.startsWith("SELECT key,value FROM public.app_kv WHERE key LIKE")) {
      const prefix = String(p[0]).slice(0, -1),
        keys = [...this.values.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort()
          .reverse();
      return {
        rows: keys.length
          ? [{ key: keys[0], value: structuredClone(this.values.get(keys[0])) }]
          : [],
      };
    }
    if (sql.startsWith("INSERT INTO public.app_kv")) {
      const key = String(p[0]),
        value = JSON.parse(String(p[1]));
      if (sql.includes("DO UPDATE")) {
        this.values.set(key, value);
        return { rows: [], rowCount: 1 };
      }
      if (
        this.values.has(key) ||
        (sql.includes("WHERE clock_timestamp()") &&
          (this.lateWrite || Date.parse(this.now) >= Date.parse(String(p[2]))))
      )
        return { rows: [], rowCount: 0 };
      if (sql.includes("recordedAt")) value.recordedAt = this.now;
      this.values.set(key, value);
      return { rows: [{ key }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT f.key"))
      return {
        rows: [...this.values]
          .filter(
            ([k, v]) =>
              k.startsWith("research:ncaaf:forecast:") &&
              !this.values.has(
                k.replace(
                  "research:ncaaf:forecast:",
                  "research:ncaaf:settlement:",
                ),
              ) &&
              Date.parse(v.target.kickoff) + 4 * 3600000 <=
                Date.parse(this.now),
          )
          .map(([key, value]) => ({ key, value: structuredClone(value) })),
      };
    if (
      sql.startsWith(
        "SELECT jsonb_build_object('researchOnly',value->'researchOnly','metrics',value->'metrics') AS value FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:",
      )
    )
      return {
        rows: [...this.values]
          .filter(([k]) => k.startsWith("research:ncaaf:settlement:"))
          .map(([, value]) => ({ value: structuredClone(value) })),
      };
    throw Error(`unhandled query: ${sql}`);
  }
}
function fixture(otCount = 30) {
  const db = new Store(),
    now = db.now,
    kickoff = "2026-10-24T18:00:00Z",
    ruleset = "ncaa-football-season-2026-unverified";
  const capture = (p: unknown) => ({
    rawResponse: JSON.stringify(p),
    requestStartedAt: now,
    receivedAt: now,
  });
  const live = buildLiveArchive(
    capture([
      {
        id: "provider1",
        sport_key: "americanfootball_ncaaf",
        home_team: "Home Eagles",
        away_team: "Away Owls",
        commence_time: kickoff,
        bookmakers: [
          {
            key: "fixture",
            last_update: now,
            markets: [
              {
                key: "spreads",
                outcomes: [
                  { name: "Home Eagles", point: -3.5, price: -110 },
                  { name: "Away Owls", point: 3.5, price: -110 },
                ],
              },
            ],
          },
        ],
      },
    ]),
    [
      capture({
        events: [
          {
            id: "999",
            season: { year: 2026 },
            competitions: [
              {
                date: kickoff,
                status: { type: { state: "pre" } },
                competitors: [
                  {
                    homeAway: "home",
                    team: { id: "1", displayName: "Home Eagles" },
                  },
                  {
                    homeAway: "away",
                    team: { id: "2", displayName: "Away Owls" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ],
  );
  const raw = JSON.stringify({ injuries: [] });
  db.values.set("research:ncaaf:injuries:2026-10-23T14:05", {
    researchOnly: true,
    observedAt: now,
    sha256: createHash("sha256").update(raw).digest("hex"),
    rawResponse: raw,
    absentTeamStatus: "unknown",
  });
  db.values.set("research:ncaaf:live-inputs:2026-10-23T14:05", live);
  const games = Array.from({ length: 6 + otCount }, (_, i) => ({
    season: 2026,
    eventId: String(i + 10),
    homeId: i < 3 ? "1" : i < 6 ? "2" : String(100 + i),
    awayId: String(200 + i),
    kickoff: "2026-09-01T12:00:00Z",
    completedAt: "2026-09-01T16:00:00Z",
    observedAt: "2026-09-01T17:00:00Z",
    source: "fixture",
    ruleset,
    homePoints: i < 6 ? 28 : 31,
    awayPoints: i < 6 ? 21 : 28,
    overtime: i >= 6,
    regulationHomePoints: i < 6 ? 28 : 21,
    regulationAwayPoints: 21,
  }));
  db.values.set("research:ncaaf:history-summary:2026:2026-10-23T14:05", {
    games,
  });
  return { db, games, kickoff };
}
test("one slot collects, records, then later scores saved probabilities without enabling release", async () => {
  const { db, games, kickoff } = fixture(),
    calls: string[] = [];
  const runCollector = async (name: string) => {
    calls.push(name);
  };
  const fetchOutcome = async () => ({
    outcome: {
      ...games[0],
      eventId: "999",
      homeId: "1",
      awayId: "2",
      kickoff,
      homePoints: 35,
      awayPoints: 21,
      regulationHomePoints: 35,
      regulationAwayPoints: 21,
      completedAt: "2026-10-24T22:00:00Z",
      observedAt: "2026-10-24T23:00:00Z",
    },
    source: { fixture: true },
  });
  const first = await runNcaafValidationPipeline({
    db,
    runCollector,
    fetchOutcome,
  });
  assert.equal(first.forecastsRecorded, 1);
  assert.equal(first.releaseEligible, false);
  const key = [...db.values.keys()].find((k) =>
      k.startsWith("research:ncaaf:forecast:"),
    )!,
    frozen = structuredClone(db.values.get(key));
  assert.ok(frozen.recordedAt);
  assert.ok(frozen.input.liveSourceEvidence.key);
  assert.equal(frozen.input.liveSourceEvidence.odds, undefined);
  const again = await runNcaafValidationPipeline({
    db,
    runCollector,
    fetchOutcome,
  });
  assert.equal(again.state, "skipped_completed_slot");
  assert.equal(calls.filter((c) => c.includes("live-inputs")).length, 1);
  db.now = "2026-10-24T23:00:00Z";
  db.values.set("research:ncaaf:live-inputs:2026-10-24T23:00", {
    ...db.values.get("research:ncaaf:live-inputs:2026-10-23T14:05"),
    matched: [],
    odds: { receivedAt: db.now },
  });
  const second = await runNcaafValidationPipeline({
    db,
    runCollector,
    fetchOutcome,
  });
  assert.equal(second.settlementsRecorded, 1);
  assert.equal(second.calibration.uniqueSettledEvents, 1);
  assert.deepEqual(db.values.get(key), frozen);
  assert.equal(second.releaseEligible, false);
});
test("thin overtime evidence is an explicit withheld result, never fallback predictions", async () => {
  const { db } = fixture(16);
  const result = await runNcaafValidationPipeline({
    db,
    runCollector: async () => {},
    fetchOutcome: async () => null,
  });
  assert.equal(result.forecastsRecorded, 0);
  assert.equal(result.forecastsWithheld, 1);
  assert.equal(result.blockers.journal_insufficient_candidate_evidence, 1);
  assert.equal(result.history[0].overtimeGames, 16);
  assert.equal(result.calibration.uniqueSettledEvents, 0);
  assert.deepEqual(result.calibration.cohorts, []);
  assert.equal(db.unlocks, 1);
});
test("crash recovery does not repeat an already-attempted paid quote request", async () => {
  const { db } = fixture();
  const slot = researchSlot(new Date(db.now));
  db.values.set(`research:ncaaf:pipeline:slot:${slot}`, {
    oddsAttempted: true,
    state: "running",
  });
  let paid = 0;
  await runNcaafValidationPipeline({
    db,
    runCollector: async (name) => {
      if (name.includes("live-inputs")) paid++;
    },
    fetchOutcome: async () => null,
  });
  assert.equal(paid, 0);
});
test("overlap, collection failure and kickoff-crossing writes fail safely", async () => {
  const a = fixture();
  a.db.lock = false;
  let calls = 0;
  const skip = await runNcaafValidationPipeline({
    db: a.db,
    runCollector: async () => {
      calls++;
    },
    fetchOutcome: async () => null,
  });
  assert.equal(skip.state, "skipped_overlap");
  assert.equal(calls, 0);
  const b = fixture();
  await assert.rejects(() =>
    runNcaafValidationPipeline({
      db: b.db,
      runCollector: async () => {
        throw Error("fixture failure");
      },
      fetchOutcome: async () => null,
    }),
  );
  assert.equal(
    b.db.values.get("research:ncaaf:pipeline:latest").state,
    "failed",
  );
  assert.equal(b.db.unlocks, 1);
  const c = fixture();
  c.db.lateWrite = true;
  const late = await runNcaafValidationPipeline({
    db: c.db,
    runCollector: async () => {},
    fetchOutcome: async () => null,
  });
  assert.equal(late.forecastsRecorded, 0);
  assert.equal(late.blockers.event_started_before_forecast_write, 1);
});
test("failed slots back off and stop retrying after three attempts", async () => {
  const { db } = fixture();
  let calls = 0;
  const deps = {
    db,
    runCollector: async () => {
      calls++;
      throw Error("failure");
    },
    fetchOutcome: async () => null,
  };
  await assert.rejects(() => runNcaafValidationPipeline(deps));
  assert.equal(
    (await runNcaafValidationPipeline(deps)).state,
    "skipped_retry_backoff",
  );
  assert.equal(calls, 1);
  db.now = "2026-10-23T14:11:00Z";
  await assert.rejects(() => runNcaafValidationPipeline(deps));
  db.now = "2026-10-23T14:17:00Z";
  await assert.rejects(() => runNcaafValidationPipeline(deps));
  db.now = "2026-10-23T14:23:00Z";
  assert.equal(
    (await runNcaafValidationPipeline(deps)).state,
    "skipped_exhausted_slot",
  );
  assert.equal(calls, 3);
});
test("abandoned running slots enforce backoff and attempt limits without a finishedAt", async () => {
  const { db } = fixture();
  const key = `research:ncaaf:pipeline:slot:${researchSlot(new Date(db.now))}`;
  let calls = 0;
  const deps = {
    db,
    runCollector: async () => {
      calls++;
    },
    fetchOutcome: async () => null,
  };
  db.values.set(key, {
    state: "running",
    attempts: 1,
    startedAt: "2026-10-23T14:04:00Z",
    oddsAttempted: true,
  });
  assert.equal(
    (await runNcaafValidationPipeline(deps)).state,
    "skipped_retry_backoff",
  );
  assert.equal(calls, 0);
  db.values.set(key, {
    state: "running",
    attempts: 3,
    startedAt: "2026-10-23T14:00:00Z",
    oddsAttempted: true,
  });
  assert.equal(
    (await runNcaafValidationPipeline(deps)).state,
    "skipped_exhausted_slot",
  );
  assert.equal(calls, 0);
});
test("UTC scheduling crosses midnight correctly and separates seasons/books/models in calibration", () => {
  assert.equal(
    researchSlot(new Date("2026-10-23T01:00:00Z")),
    "2026-10-22T22:00:00.000Z",
  );
  assert.equal(
    researchSlot(new Date("2026-10-23T14:00:00Z")),
    "2026-10-23T14:00:00.000Z",
  );
  const m = {
    modelVersion: "fixture",
    season: 2026,
    bookmaker: "A",
    market: "spread",
    eventId: "1",
    line: -3.5,
    result: "win",
    modelBrier: 0.1,
    marketBrier: 0.2,
  };
  const report = calibrationReport([
    {
      researchOnly: true,
      metrics: [
        m,
        m,
        { ...m, bookmaker: "B" },
        { ...m, season: 2025 },
        { ...m, modelVersion: "other" },
        {
          ...m,
          eventId: "2",
          result: "push",
          modelBrier: null,
          marketBrier: null,
        },
      ],
    },
  ]);
  assert.equal(report.uniqueSettledEvents, 2);
  assert.equal(report.cohorts.length, 4);
  assert.equal(report.cohorts[0].games, 1);
  assert.equal(report.cohorts[0].pushes, 1);
  assert.equal(report.releaseEligible, false);
});

import { recordOvertimeTransferForecasts } from "../src/lib/ncaafOvertimeTransferJournal.js";
function transferStore() {
  const f = fixture(16);
  f.db.values.set("research:ncaaf:history-summary:2025:fixture", {
    researchOnly: true,
    games: f.games.slice(6, 20).map((g) => ({
      ...g,
      season: 2025,
      ruleset: "ncaa-football-season-2025-unverified",
      kickoff: "2025-09-01T12:00:00Z",
      completedAt: "2025-09-01T16:00:00Z",
    })),
  });
  return f;
}
test("transfer plan never writes; explicit recording preserves first probabilities and references", async () => {
  const { db } = transferStore();
  const before = db.values.size;
  const plan = await recordOvertimeTransferForecasts(db);
  assert.equal(plan.eligible, 1);
  assert.equal(plan.recorded, 0);
  assert.equal(db.values.size, before);
  const r = await recordOvertimeTransferForecasts(db, true);
  assert.equal(r.recorded, 1);
  assert.equal(r.releaseEligible, false);
  const key = [...db.values.keys()].find((k) =>
    k.includes("forecast:ncaaf-observed-ot-transfer-research-v2:"),
  )!;
  const frozen = structuredClone(db.values.get(key));
  assert.ok(frozen.recordedAt);
  assert.ok(frozen.input.overtimeSupport.sourceKey);
  const again = await recordOvertimeTransferForecasts(db, true);
  assert.equal(again.existing, 1);
  assert.deepEqual(db.values.get(key), frozen);
});
test("transfer database clock stops late writes and stale inputs; no fallback forecasts", async () => {
  const late = transferStore();
  late.db.lateWrite = true;
  const r = await recordOvertimeTransferForecasts(late.db, true);
  assert.equal(r.recorded, 0);
  assert.equal(r.withheld, 1);
  assert.equal(r.blockers?.journal_event_started_before_forecast_write, 1);
  const stale = transferStore();
  stale.db.now = "2026-10-23T23:00:00Z";
  const s = await recordOvertimeTransferForecasts(stale.db, true);
  assert.equal(s.recorded, 0);
  assert.equal(s.blockers?.journal_stale_transfer_archive, 1);
});

test("completed collection slots still settle frozen forecasts without collector calls", async () => {
  const { db, games, kickoff } = fixture();
  await runNcaafValidationPipeline({
    db,
    runCollector: async () => {},
    fetchOutcome: async () => null,
  });
  const forecastKey = [...db.values.keys()].find((k) =>
    k.startsWith("research:ncaaf:forecast:"),
  )!;
  const frozen = structuredClone(db.values.get(forecastKey));
  db.now = "2026-10-24T23:00:00Z";
  db.values.set(
    `research:ncaaf:pipeline:slot:${researchSlot(new Date(db.now))}`,
    { state: "processed", finishedAt: db.now },
  );
  let fetches = 0;
  const deps = {
    db,
    runCollector: async () => {
      throw Error("collector must not run");
    },
    fetchOutcome: async () => {
      fetches++;
      return {
        outcome: {
          ...games[0],
          eventId: "999",
          homeId: "1",
          awayId: "2",
          kickoff,
          homePoints: 35,
          awayPoints: 21,
          regulationHomePoints: 35,
          regulationAwayPoints: 21,
          completedAt: "2026-10-24T22:00:00Z",
          observedAt: db.now,
        },
        source: { fixture: true },
      };
    },
  };
  const result = await runNcaafValidationPipeline(deps);
  assert.equal(result.state, "skipped_completed_slot");
  assert.equal(result.settlementsRecorded, 1);
  assert.deepEqual(db.values.get(forecastKey), frozen);
  assert.equal(
    db.values.get("research:ncaaf:settlement-check:latest").releaseEligible,
    false,
  );
  await runNcaafValidationPipeline(deps);
  assert.equal(fetches, 1, "repeat tick does not refetch outcomes");
});

test("collector failure cannot prevent an already eligible forecast settlement", async () => {
  const { db, games, kickoff } = fixture();
  await runNcaafValidationPipeline({
    db,
    runCollector: async () => {},
    fetchOutcome: async () => null,
  });
  db.now = "2026-10-24T23:00:00Z";
  await assert.rejects(
    runNcaafValidationPipeline({
      db,
      runCollector: async () => {
        throw Error("collector unavailable");
      },
      fetchOutcome: async () => ({
        outcome: {
          ...games[0],
          eventId: "999",
          homeId: "1",
          awayId: "2",
          kickoff,
          homePoints: 35,
          awayPoints: 21,
          regulationHomePoints: 35,
          regulationAwayPoints: 21,
          completedAt: "2026-10-24T22:00:00Z",
          observedAt: db.now,
        },
        source: { fixture: true },
      }),
    }),
  );
  assert.equal(
    [...db.values.keys()].filter((k) =>
      k.startsWith("research:ncaaf:settlement:"),
    ).length,
    1,
  );
  assert.equal(
    db.values.get("research:ncaaf:settlement-check:latest").settlementsRecorded,
    1,
  );
});

test("settlement storage failure preserves collection report and retry throttle", async () => {
  const { db } = fixture();
  const prior = {
    state: "processed",
    finishedAt: db.now,
    forecastsRecorded: 29,
  };
  db.values.set("research:ncaaf:pipeline:latest", structuredClone(prior));
  const original = db.query.bind(db);
  let pendingReads = 0;
  db.query = async (sql, p = []) => {
    if (sql.startsWith("SELECT f.key")) {
      pendingReads++;
      throw Error("database unavailable");
    }
    return original(sql, p);
  };
  await assert.rejects(
    runNcaafValidationPipeline({
      db,
      runCollector: async () => {},
      fetchOutcome: async () => null,
    }),
  );
  assert.deepEqual(db.values.get("research:ncaaf:pipeline:latest"), prior);
  const failed = db.values.get("research:ncaaf:settlement-check:latest");
  assert.equal(failed.state, "failed");
  assert.equal(Date.parse(failed.startedAt), Date.parse(db.now));
  db.values.set(
    `research:ncaaf:pipeline:slot:${researchSlot(new Date(db.now))}`,
    prior,
  );
  assert.equal(
    (
      await runNcaafValidationPipeline({
        db,
        runCollector: async () => {},
        fetchOutcome: async () => null,
      })
    ).state,
    "skipped_completed_slot",
  );
  assert.equal(
    pendingReads,
    1,
    "failed settlement check keeps its 30-minute backoff",
  );
  assert.deepEqual(db.values.get("research:ncaaf:pipeline:latest"), prior);
});

test("conference collector failure does not block existing forecast recording", async () => {
  const { db } = fixture();
  let conferenceCalls = 0;
  const result = await runNcaafValidationPipeline({
    db,
    runCollector: async (name, args) => {
      if (name === "ncaaf-conference-availability.mjs") {
        conferenceCalls++;
        assert.deepEqual(args, [
          "--capture-slot",
          researchSlot(new Date(db.now)),
        ]);
        throw Error("conference provider unavailable");
      }
    },
    fetchOutcome: async () => null,
  });
  assert.equal(conferenceCalls, 1);
  assert.equal(result.forecastsRecorded, 1);
  assert.equal(result.blockers.conference_availability_capture_failed, 1);
  assert.equal(result.releaseEligible, false);
});

test("context assembly failure stays separate from original forecast availability", async () => {
  const { db } = fixture();
  let calls = 0;
  const result = await runNcaafValidationPipeline({
    db,
    runCollector: async (name) => {
      if (name === "ncaaf-context-dataset.mjs") {
        calls++;
        throw Error("context unavailable");
      }
    },
    fetchOutcome: async () => null,
  });
  assert.equal(calls, 1);
  assert.equal(result.forecastsRecorded, 1);
  assert.equal(result.blockers.context_dataset_assembly_failed, 1);
  assert.equal(result.releaseEligible, false);
});

test("usage capture failure cannot stop original forecast recording or context assembly", async () => {
  const { db } = fixture();
  let contexts = 0;
  const result = await runNcaafValidationPipeline({
    db,
    runCollector: async (name) => {
      if (name === "ncaaf-capture-usage.mjs")
        throw Error("provider unavailable");
      if (name === "ncaaf-context-dataset.mjs") contexts++;
    },
    fetchOutcome: async () => null,
  });
  assert.equal(contexts, 1);
  assert.equal(result.forecastsRecorded, 1);
  assert.equal(result.blockers.usage_evidence_capture_failed, 1);
  assert.equal(result.releaseEligible, false);
});

test("settlement-only mode never enters collection or claims a paid-odds slot", async () => {
  const { db } = fixture();
  let calls = 0;
  const r = await runNcaafValidationPipeline({
    db,
    settlementOnly: true,
    runCollector: async () => {
      calls++;
      throw Error("must not collect");
    },
    fetchOutcome: async () => null,
  });
  assert.equal(r.state, "settlement_check_completed");
  assert.equal(calls, 0);
  assert.equal(
    [...db.values.keys()].some((k) =>
      k.startsWith("research:ncaaf:pipeline:slot:"),
    ),
    false,
  );
  assert.ok(db.values.has("research:ncaaf:settlement-check:latest"));
  assert.equal(db.unlocks, 1);
});

test("missing odds credentials preserve collection slots while settlement maintenance continues", async () => {
  const { db } = fixture();
  let calls = 0;
  const deps = {
    db,
    runCollector: async () => {
      calls++;
    },
    fetchOutcome: async () => null,
  };
  const skipped = await runNcaafValidationPipeline({
    ...deps,
    collectionEnabled: false,
  });
  assert.equal(skipped.state, "skipped_missing_odds_credentials");
  assert.equal(calls, 0);
  assert.equal(
    [...db.values.keys()].some((k) =>
      k.startsWith("research:ncaaf:pipeline:slot:"),
    ),
    false,
  );
  const restored = await runNcaafValidationPipeline({
    ...deps,
    collectionEnabled: true,
  });
  assert.equal(restored.state, "processed");
  assert.ok(calls > 0);
  assert.equal(restored.forecastsRecorded, 1);
});

test("prewarms slow evidence before the single odds capture and journals immediately after local assembly", async () => {
  const { db } = fixture();
  const calls: string[] = [];
  await runNcaafValidationPipeline({
    db,
    runCollector: async (name) => { calls.push(name); },
    onQuotesReady: async () => { calls.push("adjusted-journal"); },
    fetchOutcome: async () => null,
  });
  const odds = calls.indexOf("ncaaf-capture-live-inputs.mjs");
  assert.equal(calls.filter(x => x === "ncaaf-capture-live-inputs.mjs").length, 1);
  for (const slow of ["ncaaf-conference-availability.mjs", "ncaaf-repair-team-history.mjs", "ncaaf-capture-usage.mjs"]) {
    assert.ok(calls.indexOf(slow) >= 0 && calls.indexOf(slow) < odds);
  }
  assert.equal(calls[odds + 1], "ncaaf-context-dataset.mjs");
  assert.equal(calls[odds + 2], "adjusted-journal");
});

test("forecast processing and counts use the fresh slate rather than cached prewarm targets", async () => {
  const { db } = fixture();
  const existing = [...db.values].find(([k]) => k.startsWith("research:ncaaf:live-inputs:"))![1];
  const fresh = structuredClone(existing);
  const extra = structuredClone(fresh.matched[0]);
  extra.target.eventId = "999999";
  fresh.matched.push(extra);
  const result = await runNcaafValidationPipeline({
    db,
    runCollector: async name => {
      if(name === "ncaaf-capture-live-inputs.mjs")
        db.values.set("research:ncaaf:live-inputs:2026-10-24T14:10",fresh);
    },
    fetchOutcome: async () => null,
  });
  assert.equal(result.matchedEvents,2);
  assert.equal(result.forecastsRecorded + result.forecastsWithheld + result.forecastsAlreadyPresent,2);
  assert.equal(result.releaseEligible,false);
});

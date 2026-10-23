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
        "SELECT value FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:",
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

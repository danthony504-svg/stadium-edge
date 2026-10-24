import test from "node:test";
import assert from "node:assert/strict";
import { runNcaafResearchLifecycle } from "../src/lib/ncaafResearchLifecycle.js";
import {
  freezeModelProtocol,
  assertProspectiveHoldout,
  type ModelProtocol,
} from "../src/lib/ncaafModelProtocol.js";
class Store {
  now = "2026-10-24T10:00:00Z";
  values = new Map<string, any>();
  acquired = true;
  unlocked = 0;
  name = "stadium_edge_production";
  async query(sql: string, p: unknown[] = []) {
    if (sql.includes("current_database"))
      return { rows: [{ name: this.name }] };
    if (sql.includes("pg_try_advisory_lock"))
      return { rows: [{ acquired: this.acquired }] };
    if (sql.includes("pg_advisory_unlock")) {
      this.unlocked++;
      return { rows: [] };
    }
    if (sql.includes("clock_timestamp() AS now"))
      return { rows: [{ now: this.now }] };
    if (sql.startsWith("SELECT value FROM public.app_kv WHERE key=$1"))
      return {
        rows: this.values.has(String(p[0]))
          ? [{ value: structuredClone(this.values.get(String(p[0]))) }]
          : [],
      };
    if (sql.startsWith("INSERT INTO public.app_kv")) {
      this.values.set(String(p[0]), JSON.parse(String(p[1])));
      return { rows: [] };
    }
    if (sql.includes("research:ncaaf:settlement:%")) return { rows: [] };
    throw Error("unhandled test query");
  }
}
test("collection and transfer failures do not prevent labeling, development preparation or metrics", async () => {
  const db = new Store(),
    calls: string[] = [];
  const result = await runNcaafResearchLifecycle({
    db,
    settle: async () => {},
    collect: async () => {
      calls.push("collect");
      throw Error("provider secret must not leak");
    },
    transfer: async () => {
      calls.push("transfer");
      throw Error("transfer_archives_missing");
    },
    label: async () => {
      calls.push("label");
    },
    prepareDevelopment: async () => {
      calls.push("prepare");
    },
  });
  assert.deepEqual(calls, ["label", "prepare", "collect", "transfer"]);
  assert.equal(result.state, "partial_failure");
  assert.equal(
    db.values.get("research:ncaaf:lifecycle:latest").stages.development_labels
      .state,
    "completed",
  );
  assert.ok(db.values.has("research:ncaaf:lifecycle:metrics"));
  assert.ok(!JSON.stringify(result).includes("provider secret"));
  assert.equal(result.releaseEligible, false);
  assert.equal(db.unlocked, 1);
});
test("label failure has its own durable cadence and does not block other tasks", async () => {
  const db = new Store();
  let labels = 0,
    prepared = 0;
  const deps = {
    db,
    settle: async () => {},
    collect: async () => {},
    label: async () => {
      labels++;
      throw Error("context_invalid_final_evidence");
    },
    prepareDevelopment: async () => {
      prepared++;
    },
  };
  await runNcaafResearchLifecycle(deps);
  await runNcaafResearchLifecycle(deps);
  assert.equal(labels, 1);
  assert.equal(prepared, 1);
  assert.equal(
    db.values.get("research:ncaaf:lifecycle:stage:development_labels").state,
    "failed",
  );
  db.now = "2026-10-24T10:30:00Z";
  await runNcaafResearchLifecycle(deps);
  assert.equal(labels, 2);
  assert.equal(prepared, 2);
});
test("wrong database and overlapping workers perform no tasks", async () => {
  const db = new Store();
  let calls = 0;
  const deps = {
    db,
    settle: async () => {},
    collect: async () => {
      calls++;
    },
    label: async () => {
      calls++;
    },
    prepareDevelopment: async () => {
      calls++;
    },
  };
  db.name = "other";
  await assert.rejects(() => runNcaafResearchLifecycle(deps));
  db.name = "stadium_edge_production";
  db.acquired = false;
  assert.equal(
    (await runNcaafResearchLifecycle(deps)).state,
    "skipped_overlap",
  );
  assert.equal(calls, 0);
});
const protocol: ModelProtocol = {
  version: 1,
  modelSha256: "a".repeat(64),
  frozenAt: "2026-10-24T12:00:00Z",
  trainingGameIds: ["2026:1", "2026:2"],
  featureVersion: "ncaaf-participation-availability-v2",
  implementationCommit: "b".repeat(40),
  simulations: 10000,
  markets: ["spread", "ml"],
  settlement: "full_game_including_overtime",
  minimumIndependentGames: 500,
  minimumSeasons: 2,
};
const forecast = {
  season: 2026,
  eventId: "3",
  kickoff: "2026-10-24T18:00:00Z",
  forecastAt: "2026-10-24T13:00:00Z",
  inputCutoffAt: "2026-10-24T12:30:00Z",
  recordedAt: "2026-10-24T13:00:01Z",
  modelSha256: protocol.modelSha256,
  protocolSha256: "",
  datasetRole: "independent_holdout",
  simulations: 10000,
  settlement: protocol.settlement,
};
test("frozen protocol is canonical, immutable to callers and never approves release", () => {
  const p = structuredClone(protocol),
    f = freezeModelProtocol(p, forecast.recordedAt);
  p.trainingGameIds.push("2026:3");
  assert.equal(f.protocol.trainingGameIds.length, 2);
  assert.equal(f.releaseEligible, false);
  assert.equal(
    f.protocolSha256,
    freezeModelProtocol(
      { ...protocol, trainingGameIds: [...protocol.trainingGameIds].reverse() },
      forecast.recordedAt,
    ).protocolSha256,
  );
  assert.equal(
    assertProspectiveHoldout(f.protocol, f.protocolSha256, {
      ...forecast,
      protocolSha256: f.protocolSha256,
    }).eligibleForScoring,
    true,
  );
});
test("training leakage, late writes, retrospective forecasts, changed model and lowered requirements reject", () => {
  const f = freezeModelProtocol(protocol, forecast.recordedAt),
    base = { ...forecast, protocolSha256: f.protocolSha256 };
  for (const patch of [
    { eventId: "1" },
    { modelSha256: "c".repeat(64) },
    { recordedAt: forecast.kickoff },
    { forecastAt: "2026-10-24T11:00:00Z" },
    { datasetRole: "development_only" },
    { simulations: 9999 },
  ])
    assert.throws(() =>
      assertProspectiveHoldout(f.protocol, f.protocolSha256, {
        ...base,
        ...patch,
      }),
    );
  for (const patch of [
    { minimumIndependentGames: 499 },
    { minimumSeasons: 1 },
    { markets: ["first_half"] },
  ])
    assert.throws(() =>
      freezeModelProtocol(
        { ...protocol, ...patch } as ModelProtocol,
        forecast.recordedAt,
      ),
    );
});

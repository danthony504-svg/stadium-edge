import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptNcaabResearchFreeze,
  assertNotProductSimFreeze,
  NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES,
  NCAAB_PRODUCT_SIM_ID,
} from "../src/lib/ncaabAdjustedModelStore.js";

function fixture(seed: Record<string, unknown> = {}) {
  const values = new Map<string, any>(Object.entries(seed));
  const db = {
    unlocks: 0,
    values,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("current_database()"))
        return { rows: [{ name: "stadium_edge_production" }] };
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) {
        db.unlocks++;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      if (sql.includes("SELECT clock_timestamp() AS now"))
        return { rows: [{ now: "2026-10-30T12:00:00.000Z" }] };
      if (sql.includes("SELECT key,value FROM public.app_kv WHERE key=$1")) {
        const key = String(params?.[0]);
        return {
          rows: values.has(key) ? [{ key, value: values.get(key) }] : [],
        };
      }
      if (sql.includes("ON CONFLICT(key) DO NOTHING RETURNING key")) {
        const key = String(params?.[0]);
        if (values.has(key)) return { rows: [], rowCount: 0 };
        values.set(key, JSON.parse(String(params?.[1])));
        return { rows: [{ key }], rowCount: 1 };
      }
      if (sql.includes("ON CONFLICT(key) DO NOTHING")) {
        const key = String(params?.[0]);
        if (!values.has(key)) values.set(key, JSON.parse(String(params?.[1])));
        return { rows: [], rowCount: values.has(key) ? 0 : 1 };
      }
      if (sql.includes("INSERT INTO public.app_kv")) {
        const key = String(params?.[0]);
        values.set(key, JSON.parse(String(params?.[1])));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
  return { db };
}

test("rejects product sim as a research freeze source", () => {
  assert.throws(
    () => assertNotProductSimFreeze({ engineId: NCAAB_PRODUCT_SIM_ID }),
    /ncaab_product_sim_cannot_freeze_research_candidate/,
  );
  assert.throws(
    () =>
      assertNotProductSimFreeze({
        modelSha256: "wrapper-ncaab-score-v2-hash",
      }),
    /ncaab_product_sim_cannot_freeze_research_candidate/,
  );
});

test("waiting states never invent modelSha256 or freeze artifacts", async () => {
  const { db } = fixture();
  const result = await attemptNcaabResearchFreeze(db, "/workspace");
  assert.equal(result.state, "waiting_for_verified_development_finals");
  assert.equal(result.releaseEligible, false);
  assert.equal((result as any).coachEnabled, false);
  assert.equal((result as any).modelSha256, null);
  assert.equal(db.unlocks, 1);
  const latest = db.values.get("research:ncaab:adjusted-model:latest");
  assert.equal(latest.modelSha256, null);
  assert.equal(latest.productSimRejectedAsFreezeSource, "ncaab-score-v2");
  assert.equal(
    [...db.values.keys()].some((k) =>
      k.startsWith("research:ncaab:context-model:"),
    ),
    false,
  );
});

test("incomplete development volume waits without writing a freeze pointer", async () => {
  const examples = Array.from({ length: 3 }, (_, i) => ({
    featureComplete: true,
    season: 2026,
    eventId: String(400000000 + i),
    inputKey: `research:ncaab:context-input:v1:2026:${400000000 + i}`,
    labelKey: `research:ncaab:context-outcome:v1:2026:${400000000 + i}`,
    inputSha256: "a".repeat(64),
  }));
  const body = {
    version: 1,
    sport: "ncaab",
    datasetRole: "development_only",
    examples,
  };
  // Manifest hash must match store validation — use store's hash via dynamic import in test after writing raw.
  const { ncaabAdjustedHash } = await import(
    "../src/lib/ncaabAdjustedModel.js"
  );
  const manifestSha256 = ncaabAdjustedHash(body);
  const { db } = fixture({
    "research:ncaab:development-dataset:latest": {
      manifestSha256,
      datasetRole: "development_only",
    },
    [`research:ncaab:development-manifest:${manifestSha256}`]: body,
  });
  const result = await attemptNcaabResearchFreeze(db, "/workspace");
  assert.equal(result.state, "waiting_for_more_development_games");
  assert.equal((result as any).modelSha256, null);
  assert.ok(
    (result as any).trainingGames < NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES,
  );
  assert.equal(db.values.has("research:ncaab:context-model:first:v1"), false);
});

test("preserves an already-frozen research pointer without Coach unlock", async () => {
  const { ncaabAdjustedHash, NCAAB_ADJUSTED_FEATURE_NAMES } = await import(
    "../src/lib/ncaabAdjustedModel.js"
  );
  const n = NCAAB_ADJUSTED_FEATURE_NAMES.length;
  const artifact = {
    version: 1,
    sport: "ncaab",
    trainerVersion: "ncaab-context-ridge-research-v1",
    featureVersion: "ncaab-odds-score-features-v1",
    featureNames: [...NCAAB_ADJUSTED_FEATURE_NAMES],
    ridge: 4,
    frozenAt: "2026-10-30T11:00:00.000Z",
    implementationCommit: "a".repeat(40),
    implementationSha256: "b".repeat(64),
    developmentManifestSha256: "c".repeat(64),
    trainingGameIds: Array.from(
      { length: NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES },
      (_, i) => `2026:${1000 + i}`,
    ),
    excludedGameIds: Array.from(
      { length: NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES },
      (_, i) => `2026:${1000 + i}`,
    ),
    centers: Array(n).fill(0),
    scales: Array(n).fill(1),
    coefficients: Array(n).fill(0),
    ranges: Array.from({ length: n }, () => ({ min: -10, max: 10 })),
    researchOnly: true,
    productionReady: false,
    validationReady: false,
    releaseEligible: false,
    coachEnabled: false,
    evaluationPolicy: {
      bookPriority: ["fanduel"],
      primaryMarket: "spread",
      secondaryMarkets: ["ml", "total"],
    },
    limitations: ["test"],
  };
  // Fix ranges[0] for intercept
  artifact.ranges[0] = { min: 1, max: 1 };
  const modelSha256 = ncaabAdjustedHash(artifact);
  const { db } = fixture({
    "research:ncaab:context-model:first:v1": {
      state: "frozen_research_candidate",
      modelSha256,
      modelKey: `research:ncaab:context-model:artifact:${modelSha256}`,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
    },
    [`research:ncaab:context-model:artifact:${modelSha256}`]: artifact,
  });
  const result = await attemptNcaabResearchFreeze(db, "/workspace");
  assert.equal(result.state, "frozen_candidate_preserved");
  assert.equal(result.modelSha256, modelSha256);
  assert.equal(result.releaseEligible, false);
  assert.equal((result as any).coachEnabled, false);
  assert.equal((result as any).validationReady, false);
});

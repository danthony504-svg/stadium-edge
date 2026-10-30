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

test("freeze attempt waits for development manifest without inventing modelSha256", async () => {
  const { db } = fixture();
  const result = await attemptNcaabResearchFreeze(db);
  assert.equal(result.state, "waiting_for_verified_development_finals");
  assert.equal(result.releaseEligible, false);
  assert.equal((result as any).coachEnabled, false);
  assert.equal((result as any).modelSha256, null);
  assert.equal(db.unlocks, 1);
  const latest = db.values.get("research:ncaab:adjusted-model:latest");
  assert.equal(latest.modelSha256, null);
  assert.ok(
    latest.reasons.includes("ncaab_context_prepare_pipeline_not_built"),
  );
  assert.equal(
    latest.productSimRejectedAsFreezeSource,
    "ncaab-score-v2",
  );
});

test("enough development examples still wait for the unimplemented trainer", async () => {
  const examples = Array.from(
    { length: NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES },
    (_, i) => ({
      featureComplete: true,
      season: 2026,
      eventId: String(400000000 + i),
    }),
  );
  const manifestSha256 =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const { db } = fixture({
    "research:ncaab:development-dataset:latest": {
      manifestSha256,
      datasetRole: "development_only",
    },
    [`research:ncaab:development-manifest:${manifestSha256}`]: {
      datasetRole: "development_only",
      examples,
    },
  });
  const result = await attemptNcaabResearchFreeze(db);
  assert.equal(result.state, "waiting_for_ncaab_research_trainer");
  assert.equal((result as any).modelSha256, null);
  assert.equal((result as any).trainingGames, NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES);
  assert.ok(
    (result as any).reasons.includes(
      "refusing_to_freeze_product_sim_ncaab_score_v2",
    ),
  );
});

test("preserves an already-frozen research pointer without Coach unlock", async () => {
  const modelSha256 =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const { db } = fixture({
    "research:ncaab:context-model:first:v1": {
      state: "frozen_research_candidate",
      modelSha256,
      modelKey: `research:ncaab:context-model:artifact:${modelSha256}`,
      researchOnly: true,
      releaseEligible: false,
    },
    [`research:ncaab:context-model:artifact:${modelSha256}`]: {
      trainerVersion: "ncaab-context-ridge-research-v1",
      trainingGameIds: ["2026:1"],
      researchOnly: true,
      productionReady: false,
    },
  });
  const result = await attemptNcaabResearchFreeze(db);
  assert.equal(result.state, "frozen_candidate_preserved");
  assert.equal(result.modelSha256, modelSha256);
  assert.equal(result.releaseEligible, false);
  assert.equal((result as any).coachEnabled, false);
  assert.equal((result as any).validationReady, false);
});

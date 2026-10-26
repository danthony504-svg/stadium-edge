import test from "node:test";
import assert from "node:assert/strict";
import {
  ncaabResearchSlot,
  runNcaabValidationPipeline,
  NCAAB_MIN_INDEPENDENT_GAMES,
  NCAAB_MIN_SEASONS,
} from "../src/lib/ncaabValidationPipeline.js";
import { ncaabPipelineReadiness } from "../src/lib/ncaabPipelineReadiness.js";

function fixture(nowIso = "2026-10-26T17:30:00.000Z") {
  const values = new Map<string, any>();
  const db = {
    now: nowIso,
    values,
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
              forecasts: 0,
              settlements: 0,
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
      if (sql.includes("INSERT INTO public.app_kv")) {
        const key = String(params?.[0]);
        const value = JSON.parse(String(params?.[1]));
        values.set(key, value);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("research:ncaab:forecast:%"))
        return { rows: [] };
      if (sql.includes("key=ANY")) return { rows: [] };
      if (sql.includes("live-inputs:")) return { rows: [] };
      return { rows: [] };
    },
  };
  return { db };
}

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
    runCollector: async (name) => {
      calls.push(name);
    },
  });
  assert.equal(r.state, "processed");
  assert.equal(r.releaseEligible, false);
  assert.equal(r.coachEnabled, false);
  assert.deepEqual(calls, ["ncaab-capture-live-inputs.mjs"]);
  assert.equal(
    db.values.get("research:ncaab:pipeline:latest").blockers
      .waiting_for_frozen_ncaab_candidate,
    1,
  );
  assert.equal(
    [...db.values.keys()].some((k) => k.startsWith("research:ncaab:forecast:")),
    false,
  );
});

test("completed NCAAB slot does not re-charge odds", async () => {
  const { db } = fixture();
  await runNcaabValidationPipeline({
    db,
    runCollector: async () => {},
  });
  const again = await runNcaabValidationPipeline({
    db,
    runCollector: async () => {
      throw Error("must not collect again");
    },
  });
  assert.equal(again.state, "skipped_completed_slot");
  assert.equal(again.releaseEligible, false);
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

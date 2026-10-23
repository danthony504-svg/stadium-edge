import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyOperationalSchemaMigration } from "../src/lib/operationalSchemaMigration.js";

test("operational migration refuses the wrong database before DDL", async () => {
 const calls: string[] = [];
 await assert.rejects(() => applyOperationalSchemaMigration({ query: async sql => {
  calls.push(sql); return {rows: [{name: "other"}]};
 } }, "DDL"), /unexpected_database/);
 assert.deepEqual(calls, ["SELECT current_database() AS name"]);
});
test("operational migration rolls back a failed transaction", async () => {
 const calls: string[] = [];
 await assert.rejects(() => applyOperationalSchemaMigration({ query: async sql => {
  calls.push(sql); if (sql === "DDL") throw Error("failed");
  return {rows: [{name: "stadium_edge_production"}]};
 } }, "DDL"), /failed/);
 assert.equal(calls.at(-1), "ROLLBACK");
});
test("repair SQL is create-only, bounded and includes webhook idempotence", () => {
 const sql = readFileSync(new URL("../../../lib/db/migrations/20261023_create_missing_operational_tables.sql", import.meta.url), "utf8");
 assert.doesNotMatch(sql, /^\s*(?:ALTER|DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/im);
 for (const table of ["subscription_events", "live_steals", "referral_accounts", "referral_conversions", "referral_offer_codes", "referral_rewards"])
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
 assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_event_key_uidx/);
 assert.match(sql, /lock_timeout = '5s'/);
 assert.match(sql, /statement_timeout = '30s'/);
});

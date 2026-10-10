#!/usr/bin/env node
/**
 * Verify coach_precomputed_slate exists and print schema + row freshness.
 * Requires DATABASE_URL (production Postgres). Does not modify data.
 *
 *   DATABASE_URL='postgres://…' node artifacts/api-server/scripts/verify-coach-slate-db.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("FAIL: DATABASE_URL is required");
  process.exit(1);
}

const EXPECTED_COLUMNS = [
  "id",
  "fingerprint",
  "data",
  "deep_sim_complete",
  "computed_at",
  "updated_at",
];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const table = await client.query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_name = 'coach_precomputed_slate'`,
  );
  if (table.rowCount === 0) {
    console.error("FAIL: table coach_precomputed_slate does not exist");
    console.error("Apply schema: pnpm --filter @workspace/db run push (with approval)");
    process.exit(1);
  }
  console.log("OK table:", table.rows[0]);

  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = 'coach_precomputed_slate'
     ORDER BY ordinal_position`,
  );
  const names = cols.rows.map((r) => r.column_name);
  console.log("columns:", cols.rows);
  for (const c of EXPECTED_COLUMNS) {
    if (!names.includes(c)) {
      console.error(`FAIL: missing column ${c}`);
      process.exit(1);
    }
  }
  console.log("OK schema columns match expected set");

  const row = await client.query(
    `SELECT id, fingerprint, deep_sim_complete, computed_at, updated_at,
            pg_column_size(data) AS data_bytes,
            CASE WHEN data IS NULL THEN NULL ELSE jsonb_typeof(data) END AS data_type,
            CASE
              WHEN data ? 'activeSports' THEN jsonb_array_length(COALESCE(data->'activeSports','[]'::jsonb))
              ELSE NULL
            END AS active_sports_len,
            CASE
              WHEN data #> '{boardScan,picks}' IS NOT NULL
              THEN jsonb_array_length(COALESCE(data#> '{boardScan,picks}','[]'::jsonb))
              ELSE NULL
            END AS board_scan_picks
     FROM coach_precomputed_slate
     WHERE id = 'global'`,
  );
  if (row.rowCount === 0) {
    console.log("ROW: missing id=global (cron has not persisted yet)");
    process.exit(2);
  }
  const r = row.rows[0];
  const ageMs = r.computed_at ? Date.now() - new Date(r.computed_at).getTime() : null;
  console.log("ROW:", {
    id: r.id,
    fingerprint: r.fingerprint,
    deep_sim_complete: r.deep_sim_complete,
    computed_at: r.computed_at,
    updated_at: r.updated_at,
    data_bytes: r.data_bytes,
    data_type: r.data_type,
    active_sports_len: r.active_sports_len,
    board_scan_picks: r.board_scan_picks,
    age_ms: ageMs,
    age_min: ageMs != null ? Math.round(ageMs / 60000) : null,
  });
  if (!r.computed_at || r.data_bytes == null || Number(r.data_bytes) < 2) {
    console.error("FAIL: global row present but snapshot payload looks empty");
    process.exit(1);
  }
  console.log("OK global snapshot row present with JSON payload");
} finally {
  await client.end();
}

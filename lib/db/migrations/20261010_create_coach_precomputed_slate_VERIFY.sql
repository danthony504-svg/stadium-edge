-- Read-only verification for coach_precomputed_slate (no writes).
-- Run in Render Web Shell / psql against production DATABASE_URL after the
-- create migration, or before it to confirm the table is still missing.

-- 1) Table present?
SELECT to_regclass('public.coach_precomputed_slate') AS regclass;
-- Expect after migration: public.coach_precomputed_slate
-- Expect before migration: NULL

-- 2) Exact columns / nullability / defaults
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'coach_precomputed_slate'
ORDER BY ordinal_position;

-- Expect exactly these six columns (order may vary by ordinal):
--   id                 text / text      NO   'global'::text  (or similar)
--   fingerprint        text / text      NO   NULL
--   data               jsonb / jsonb    NO   NULL
--   deep_sim_complete  boolean / bool   NO   false
--   computed_at        timestamp with time zone / timestamptz  NO  now()
--   updated_at         timestamp with time zone / timestamptz  NO  now()

-- 3) Primary key only (no unexpected indexes required by schema)
SELECT
  i.relname AS index_name,
  ix.indisprimary AS is_primary,
  pg_get_indexdef(ix.indexrelid) AS index_def
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'coach_precomputed_slate'
ORDER BY i.relname;

-- Expect: one primary-key index on (id)

-- 4) Row state (empty until first successful cron persist)
SELECT
  id,
  fingerprint,
  deep_sim_complete,
  computed_at,
  updated_at,
  pg_column_size(data) AS data_bytes,
  jsonb_typeof(data) AS data_type,
  CASE
    WHEN data ? 'activeSports'
      THEN jsonb_array_length(COALESCE(data->'activeSports', '[]'::jsonb))
    ELSE NULL
  END AS active_sports_len,
  CASE
    WHEN data #> '{boardScan,picks}' IS NOT NULL
      THEN jsonb_array_length(COALESCE(data #> '{boardScan,picks}', '[]'::jsonb))
    ELSE NULL
  END AS board_scan_picks
FROM public.coach_precomputed_slate
WHERE id = 'global';
-- Expect immediately after create: 0 rows
-- Expect after successful cron: 1 row with jsonb data, active_sports_len >= 0

-- 5) Safety: confirm migration did not drop peer tables (spot-check)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

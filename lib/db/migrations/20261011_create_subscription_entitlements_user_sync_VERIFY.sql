-- Read-only verification for subscription_entitlements + user_sync.
-- Run against production DATABASE_URL before (expect NULL) and after
-- (expect both regclasses + columns/PKs) the create-only migration.
-- No writes.

-- =============================================================================
-- 1) Tables present?
-- =============================================================================
SELECT
  to_regclass('public.subscription_entitlements') AS subscription_entitlements,
  to_regclass('public.user_sync') AS user_sync;
-- Expect BEFORE: NULL, NULL
-- Expect AFTER:  public.subscription_entitlements, public.user_sync

-- =============================================================================
-- 2) subscription_entitlements columns
-- =============================================================================
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'subscription_entitlements'
ORDER BY ordinal_position;

-- Expect exactly:
--   user_id               text / text      NO   NULL
--   plan_id               text / text      NO   'free'::text
--   product_id            text / text      YES  NULL
--   status                text / text      NO   'unknown'::text
--   expires_at            timestamptz      YES  NULL
--   management_url        text / text      YES  NULL
--   original_app_user_id  text / text      YES  NULL
--   source                text / text      NO   'client_sync'::text
--   store_kit_active      boolean / bool   NO   false
--   updated_at            timestamptz      NO   now()
--   created_at            timestamptz      NO   now()

-- =============================================================================
-- 3) user_sync columns
-- =============================================================================
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_sync'
ORDER BY ordinal_position;

-- Expect exactly:
--   user_id     text / text      NO   NULL
--   namespace   text / text      NO   NULL
--   data        jsonb / jsonb    NO   NULL
--   updated_at  timestamptz      NO   now()

-- =============================================================================
-- 4) Indexes / primary keys
-- =============================================================================
SELECT
  t.relname AS table_name,
  i.relname AS index_name,
  ix.indisprimary AS is_primary,
  pg_get_indexdef(ix.indexrelid) AS index_def
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('subscription_entitlements', 'user_sync')
ORDER BY t.relname, i.relname;

-- Expect:
--   subscription_entitlements → one PRIMARY KEY on (user_id)
--   user_sync                 → one PRIMARY KEY on (user_id, namespace)
-- No extra secondary indexes required by current drizzle schema.

-- =============================================================================
-- 5) Constraint names (optional detail)
-- =============================================================================
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('subscription_entitlements', 'user_sync')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- =============================================================================
-- 6) Row counts (expect empty immediately after create)
-- =============================================================================
SELECT
  'subscription_entitlements'::text AS table_name,
  COUNT(*)::bigint AS row_count
FROM public.subscription_entitlements
UNION ALL
SELECT
  'user_sync'::text,
  COUNT(*)::bigint
FROM public.user_sync;

-- =============================================================================
-- 7) Safety spot-check: peer tables still present; out-of-scope untouched
-- =============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'subscription_entitlements',
    'user_sync',
    'reliability_events',
    'coach_precomputed_slate'
  )
ORDER BY table_name;

-- Note: subscription_events is intentionally NOT created by this migration.
-- restore-verify records events there; if that table is also missing, event
-- logging may fail even after entitlements exist (separate follow-up).

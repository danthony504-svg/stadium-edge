-- Idempotent create-only migration for missing production tables.
-- Source of truth:
--   lib/db/src/schema/subscriptions.ts  → public.subscription_entitlements
--   lib/db/src/schema/userSync.ts       → public.user_sync
--
-- Proven missing on production (2026-10-11):
--   to_regclass('public.subscription_entitlements') = NULL
--   to_regclass('public.user_sync') = NULL
--
-- SAFE:
--   - CREATE TABLE IF NOT EXISTS only (PKs created with the tables)
--   - No DROP / TRUNCATE / DELETE / ALTER / RENAME
--   - Does not touch reliability_events or unrelated tables
--   - Does not create subscription_events (out of scope for this migration)
--   - Re-running is a no-op when objects already exist
--
-- Code paths that require these tables:
--   purchase sync / restore-verify / entitlement GET / webhooks
--     → artifacts/api-server/src/routes/subscriptions.ts (upsert + select by user_id)
--   owner / paid premium API gate
--     → artifacts/api-server/src/lib/subscriptionAccess.ts (select by user_id)
--   savedSlips (+ tracker/results/fantasyRosters/coachBuild/notifPrefs)
--     → artifacts/api-server/src/routes/sync.ts
--     → artifacts/api-server/src/lib/notifyJobs.ts (savedSlips + notifPrefs)
--     → artifacts/api-server/src/lib/coachBuild.ts (coachBuild namespaces)
--
-- Apply only with explicit ops approval on production Postgres
-- (Render Web Shell or psql with DATABASE_URL). Do NOT use drizzle-kit push.

BEGIN;

-- ---------------------------------------------------------------------------
-- public.subscription_entitlements
-- PK: user_id (Clerk user id). Lookups: WHERE user_id = $1 LIMIT 1
-- Upsert: ON CONFLICT (user_id) DO UPDATE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_entitlements (
  user_id text PRIMARY KEY,
  plan_id text NOT NULL DEFAULT 'free',
  product_id text,
  status text NOT NULL DEFAULT 'unknown',
  expires_at timestamptz,
  management_url text,
  original_app_user_id text,
  source text NOT NULL DEFAULT 'client_sync',
  store_kit_active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subscription_entitlements IS
  'Per-user Apple/RevenueCat entitlement mirror (purchase sync, restore-verify, webhooks).';

-- No secondary indexes in drizzle schema. Primary key on user_id covers
-- entitlement GET, restore-verify, sync upsert conflict target, and
-- subscriptionAccess paid lookup.

-- ---------------------------------------------------------------------------
-- public.user_sync
-- Composite PK: (user_id, namespace). Upsert conflict on the same pair.
-- data is opaque client/server JSON (savedSlips, tracker, results, …).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_sync (
  user_id text NOT NULL,
  namespace text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, namespace)
);

COMMENT ON TABLE public.user_sync IS
  'Per-user cloud sync blobs keyed by Clerk user_id + namespace (savedSlips, etc.).';

-- No secondary indexes in drizzle schema. Composite PK covers
-- GET/PUT /api/sync/:namespace and notifyJobs savedSlips/notifPrefs lookups.
-- coachBuild pending delete uses PK columns + jsonb ->> 'buildId' filter
-- (no extra index required by schema).

COMMIT;

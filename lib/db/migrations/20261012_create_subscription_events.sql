-- Idempotent create-only migration for missing production table.
-- Source of truth:
--   lib/db/src/schema/subscriptions.ts → public.subscription_events
--
-- Proven missing on production (2026-10-12):
--   relation "subscription_events" does not exist
--   → POST /subscriptions/sync and /subscriptions/restore-verify 500 after
--     RESTORE_VERIFY_ACTIVE (RevenueCat verify succeeded; recordEvent crashed).
--
-- SAFE:
--   - CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS only
--   - No DROP / TRUNCATE / DELETE / ALTER / RENAME
--   - Does not touch subscription_entitlements, user_sync, or unrelated tables
--   - Re-running is a no-op when objects already exist
--
-- Code paths that require this table:
--   artifacts/api-server/src/routes/subscriptions.ts (recordEvent audit log)
--   artifacts/api-server/src/routes/account.ts (delete subscription events)
--
-- Apply only with explicit ops approval on production Postgres
-- (Render Web Shell or psql with DATABASE_URL). Do NOT use drizzle-kit push.

BEGIN;

-- ---------------------------------------------------------------------------
-- public.subscription_events
-- PK: serial id
-- Unique: event_key (webhook notification id or synthetic client sync key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id serial PRIMARY KEY,
  event_key text NOT NULL,
  user_id text,
  event_type text NOT NULL,
  payload text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_event_key_uidx
  ON public.subscription_events (event_key);

COMMENT ON TABLE public.subscription_events IS
  'Idempotent log of RevenueCat webhook / client sync / restore-verify events.';

COMMIT;

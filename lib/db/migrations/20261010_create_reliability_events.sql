-- Idempotent create-only migration for Phase A crash reporting.
-- Source of truth: lib/db/src/schema/reliabilityEvents.ts
--
-- SAFE:
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only
--   - No DROP / TRUNCATE / DELETE / ALTER of other tables
--   - Re-running is a no-op when objects already exist
--
-- Apply only with explicit ops approval on the production Postgres linked to
-- stadium-edge.onrender.com (Render Web Shell or psql with DATABASE_URL).
-- Do not use drizzle-kit push for this change.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reliability_events (
  id serial PRIMARY KEY,
  fingerprint text NOT NULL,
  severity text NOT NULL DEFAULT 'critical',
  error_message text NOT NULL,
  error_stack text,
  component_stack text,
  update_id text,
  runtime_version text,
  channel text,
  app_version text,
  bundle_source text,
  platform text,
  session_id text,
  client_ts timestamptz,
  occurrence_count integer NOT NULL DEFAULT 1,
  last_alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reliability_events_fingerprint_idx
  ON public.reliability_events (fingerprint);

CREATE INDEX IF NOT EXISTS reliability_events_created_at_idx
  ON public.reliability_events (created_at);

COMMENT ON TABLE public.reliability_events IS
  'Phase A mobile crash reports (sanitized, bounded retention).';

COMMIT;

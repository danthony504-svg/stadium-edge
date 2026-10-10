-- Idempotent create-only migration for missing production table.
-- Source of truth: lib/db/src/schema/coachPrecomputedSlate.ts
--
-- SAFE:
--   - CREATE TABLE IF NOT EXISTS only (no DROP / TRUNCATE / DELETE / ALTER of other tables)
--   - Does not insert, update, or delete any row data
--   - Re-running is a no-op when the table already exists
--
-- UNSAFE alternatives (do NOT use for this fix):
--   - pnpm --filter @workspace/db run push       (can create/alter ANY drizzle schema table)
--   - pnpm --filter @workspace/db run push-force (same, forced)
--
-- Apply only with explicit ops approval on the production Postgres linked to
-- stadium-edge.onrender.com (Render Web Shell or psql with DATABASE_URL).

BEGIN;

CREATE TABLE IF NOT EXISTS public.coach_precomputed_slate (
  id text PRIMARY KEY DEFAULT 'global',
  fingerprint text NOT NULL,
  data jsonb NOT NULL,
  deep_sim_complete boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Drizzle schema defines no secondary indexes. Primary key on id is sufficient
-- for the API's only lookup: WHERE id = 'global' LIMIT 1
-- (artifacts/api-server/src/lib/coachSlateStore.ts).

COMMENT ON TABLE public.coach_precomputed_slate IS
  'Global AI Coach slate pre-analysis snapshot (one row id=global, latest-wins).';

COMMIT;

-- Deploy this migration before enabling the unified performance API.
-- The existing live_steals table is intentionally left in place for the
-- +500 Steals feed; Home no longer depends on it.
CREATE TABLE IF NOT EXISTS app_performance (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  identity text NOT NULL,
  source text NOT NULL,
  sport text NOT NULL,
  provider_event_id text NOT NULL,
  game text NOT NULL,
  market text NOT NULL,
  selection text NOT NULL,
  line text,
  odds integer NOT NULL,
  starts_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  result_detail text,
  settled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS app_performance_user_identity_uidx
  ON app_performance (user_id, identity);
CREATE INDEX IF NOT EXISTS app_performance_user_created_idx
  ON app_performance (user_id, created_at);
CREATE INDEX IF NOT EXISTS app_performance_pending_idx
  ON app_performance (status, starts_at);

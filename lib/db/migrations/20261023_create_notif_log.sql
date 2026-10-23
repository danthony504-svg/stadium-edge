-- Create-only repair matching src/schema/notifications.ts. Existing data survives.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS public.notif_log (
  user_id text NOT NULL,
  dedupe_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dedupe_key)
);
COMMIT;

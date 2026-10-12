-- Read-only verification for subscription_events.
-- Run against production DATABASE_URL before (expect NULL) and after
-- (expect regclass + columns + unique index) the create-only migration.
-- No writes.

-- =============================================================================
-- 1) Table present?
-- =============================================================================
SELECT to_regclass('public.subscription_events') AS subscription_events;
-- Expect BEFORE: NULL
-- Expect AFTER:  public.subscription_events

-- =============================================================================
-- 2) Columns
-- =============================================================================
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'subscription_events'
ORDER BY ordinal_position;

-- Expect exactly:
--   id          integer / int4      NO   nextval(...)
--   event_key   text / text         NO   NULL
--   user_id     text / text         YES  NULL
--   event_type  text / text         NO   NULL
--   payload     text / text         YES  NULL
--   created_at  timestamptz         NO   now()

-- =============================================================================
-- 3) Unique index on event_key
-- =============================================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'subscription_events'
ORDER BY indexname;

-- Expect AFTER: subscription_events_event_key_uidx UNIQUE on event_key
-- (plus primary key index on id)

-- Read-only verification. Expect three non-null columns and a primary key on key.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'app_kv'
ORDER BY ordinal_position;

SELECT pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = to_regclass('public.app_kv') AND contype = 'p';

-- A real heartbeat appears only after the scheduled cron completes successfully.
-- Do not insert a fake heartbeat to make health checks look successful.
SELECT key, value, updated_at
FROM public.app_kv
WHERE key = 'cron:heartbeat';

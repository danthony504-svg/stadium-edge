# coach_precomputed_slate — create-only migration (approval packet)

**Status:** prepared for ops approval. **Do not apply** until explicitly approved.  
**Root cause (Render Web Shell):** `to_regclass('public.coach_precomputed_slate')` → `NULL`; table absent from the production DB the API uses.

## 1. Schema source of truth (deployed API)

Drizzle table `lib/db/src/schema/coachPrecomputedSlate.ts`:

| Column | PG type | Null | Default | Role |
|---|---|---|---|---|
| `id` | `text` | NOT NULL | `'global'` | PK; API always uses `id = 'global'` |
| `fingerprint` | `text` | NOT NULL | — | Slate fingerprint string |
| `data` | `jsonb` | NOT NULL | — | Full `SlatePreAnalysisSnapshot` JSON |
| `deep_sim_complete` | `boolean` | NOT NULL | `false` | Deep-sim completion flag |
| `computed_at` | `timestamptz` | NOT NULL | `now()` | Set on insert by persist |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Updated on every persist upsert |

**Indexes:** primary key on `id` only. No secondary indexes in the Drizzle schema.  
API access path (`coachSlateStore.ts`):

- **Read:** `SELECT … WHERE id = 'global' LIMIT 1` (GET + open-parlay preview)
- **Write:** `INSERT … ON CONFLICT (id) DO UPDATE` (cron `persistCoachPrecomputedSlate`)

Freshness for GET uses the JSON snapshot `at` field inside `data`, not a DB expression.  
GET exposes `computedAt` from the row’s `updated_at` column.

There is **no** checked-in historical SQL migration ledger for this DB; schema sync historically used `drizzle-kit push` (`@workspace/db` scripts). That full push is **not** recommended for this fix because it can affect every table in `lib/db/src/schema`.

## 2. Migration files (create-only)

| File | Purpose |
|---|---|
| `lib/db/migrations/20261010_create_coach_precomputed_slate.sql` | Idempotent `CREATE TABLE IF NOT EXISTS` + PK + comment |
| `lib/db/migrations/20261010_create_coach_precomputed_slate_VERIFY.sql` | Read-only verification queries |

### Exact apply command (Render PostgreSQL)

In **Render → Postgres → Connect → Web Shell** (or `psql` with production `DATABASE_URL`):

```bash
# Optional: paste the SQL file contents, or:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS public.coach_precomputed_slate (
  id text PRIMARY KEY DEFAULT 'global',
  fingerprint text NOT NULL,
  data jsonb NOT NULL,
  deep_sim_complete boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.coach_precomputed_slate IS
  'Global AI Coach slate pre-analysis snapshot (one row id=global, latest-wins).';

COMMIT;
SQL
```

## 3. Safety checks (why this will not modify/delete existing data)

| Check | Result |
|---|---|
| Statements used | `BEGIN` / `CREATE TABLE IF NOT EXISTS` / `COMMENT ON TABLE` / `COMMIT` only |
| `DROP` / `TRUNCATE` / `DELETE` / `UPDATE` / `ALTER … DROP` | **None** |
| Other tables | Untouched — SQL names only `public.coach_precomputed_slate` |
| Existing data | No DML; empty table after create (0 rows until cron persists) |
| Re-run | Idempotent: second apply is a no-op if table exists |
| vs `drizzle-kit push` | Safer — push may create/alter unrelated schema tables |

**Caveat:** `IF NOT EXISTS` skips creation if a table of that name already exists with a *wrong* shape. Production currently has **no** table (`to_regclass` NULL), so the create will apply cleanly. Post-apply, run the VERIFY SQL and confirm the six columns match.

## 4. Post-create verification commands

```bash
# A) Table exists
psql "$DATABASE_URL" -c "SELECT to_regclass('public.coach_precomputed_slate');"
# Expect: public.coach_precomputed_slate

# B) Column set
psql "$DATABASE_URL" -c "
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='coach_precomputed_slate'
ORDER BY ordinal_position;"

# C) Repo verifier (exit 2 = table OK, no global row yet — expected before cron)
DATABASE_URL='…' node artifacts/api-server/scripts/verify-coach-slate-db.mjs
```

## 5. Cron persist / GET retrieve (once table + cron key exist)

No Coach algorithm changes required. After the table exists and `COACH_SLATE_CRON_KEY` is set on Render:

1. Wrong key → `403 {"error":"forbidden"}` (not `503 cron not configured`)
2. Authenticated refresh (ops only, separate approval):

```bash
curl -sS --max-time 300 -X POST \
  -H "x-cron-key: $COACH_SLATE_CRON_KEY" \
  https://stadium-edge.onrender.com/api/coach/slate/cron
```

Expect HTTP **200** with `ok: true` and a `summary` including `durationMs`, `oddsCount`, `boardScanPicks`, `sports`, etc. On failure the deployed route returns **500** / `ok: false` (fail-closed).

3. Row persisted:

```bash
psql "$DATABASE_URL" -c "
SELECT id, deep_sim_complete, computed_at, updated_at,
       jsonb_array_length(COALESCE(data->'activeSports','[]'::jsonb)) AS active_sports
FROM coach_precomputed_slate WHERE id='global';"
```

4. GET remains read-only (does not start a job):

```bash
curl -sS https://stadium-edge.onrender.com/api/coach/slate | jq '{fresh, refreshing, computedAt, activeSports, hasSnapshot: (.snapshot!=null)}'
```

## 6. Out of scope (unchanged)

Coach selection, sportsbook odds math, simulations, grading, NCAAF safeguards, Simulator V2, Clerk, and RevenueCat are **not** modified by this migration packet.

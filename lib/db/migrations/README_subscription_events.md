# subscription_events production migration

## Incident (2026-10-12)

RevenueCat restore-verify succeeded (`RESTORE_VERIFY_ACTIVE`, `planId: go`) then
crashed in `recordEvent` because production Postgres lacked
`public.subscription_events`. That turned verified Go into HTTP 500 for:

- `POST /api/subscriptions/sync`
- `POST /api/subscriptions/restore-verify`

## Apply (ops)

```bash
# From repo root, with production DATABASE_URL (Render Web Shell or local psql):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/20261012_create_subscription_events.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/20261012_create_subscription_events_VERIFY.sql
```

Do **not** use `drizzle-kit push` for this recovery.

## Code companion

`recordEvent` in `artifacts/api-server/src/routes/subscriptions.ts` treats audit
log failures as non-fatal so a missing audit table cannot block a trusted
Go/Pro response. The table should still be created so webhook idempotency and
account-delete cleanup work.

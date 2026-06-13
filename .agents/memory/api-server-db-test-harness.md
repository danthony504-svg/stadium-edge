---
name: api-server DB-coupled unit test harness
description: How to unit-test api-server modules that import @workspace/db / push / drizzle under `node --test`, around two hard resolution walls.
---

# api-server DB-coupled test harness

`@workspace/api-server` tests run via `node --test 'test/**/*.test.ts'` (native
type-stripping, no jest/vitest). Two walls block testing any module that touches
the database:

1. **`node --test` does NOT resolve `.js` import specifiers to their `.ts`
   files.** The codebase writes NodeNext-style `.js` in relative imports (esbuild
   rewrites them in the real build), but node's runtime resolver throws
   `ERR_MODULE_NOT_FOUND` on `./foo.js` when only `foo.ts` exists. So importing
   any module whose graph uses `.js` specifiers (e.g. `coachBuild.ts` →
   `./push.js`, `./coachBuildSweep.js`) fails outright.
2. **`@workspace/db` throws at import time** if `DATABASE_URL` is unset and spins
   up a real pg `Pool`. Pure logic modules dodge this by being import-free; any
   db-coupled module cannot.

## The fix (test-only, zero production changes)
A `--import`ed resolve shim + in-memory fakes:
- `test/register-hooks.mjs` uses `module.registerHooks({ resolve })` (node ≥24)
  to (a) generically rewrite relative `*.js` → `*.ts` when only the `.ts` exists,
  and (b) **scoped by `context.parentURL`** redirect the module-under-test's
  `@workspace/db`, `./push.js`, and `drizzle-orm` imports to fakes under
  `test/fakes/`. Scoping by parentURL keeps other suites on the real modules.
- The package `test` script must load it: `node --import ./test/register-hooks.mjs --test …`.
- `test/fakes/db.ts` is an in-memory drizzle stand-in. WRITES (upserts, notif_log
  claims) still **dispatch on TABLE IDENTITY** and are captured. But READS/DELETES
  are now **predicate-aware**: the `drizzle-orm` stub captures structured nodes
  (`{t:"eq"|"lt"|"like"|"inArray"|"and"|"or"|"sql", a, b/parts}`) instead of
  no-ops, so the fake routes the three distinct user_sync SELECTs (marker scan vs
  per-user stash lookup vs notifPrefs — all keyed off the namespace `eq` value)
  and actually EVALUATES the cron pruner's DELETE WHEREs (age cutoff + dedupe-key
  `like` scoping). `delete().where()` returns a Promise with a `.returning()`
  attached. It exports a mutable `__control` (canned select rows per
  purpose: notifPrefsRows/tokenRows/markerRows/stashByUser/*DeleteRows, captured
  upsert payloads, delete counts, matched-delete rows, a notif_log dedupe Set) +
  `resetDb()`. The fake and the test share one module instance, so the test
  configures `__control` and asserts against it.
- `test/fakes/push.ts` records `sendPush` calls + lets a test inject
  `invalidTokens`.

**Why this shape:** dispatch-by-table makes the tests order-independent; the
notif_log Set makes the at-most-once dedupe assertion real (a 2nd call for the
same buildId returns `[]` from `.returning()`). Verified meaningful by a mutation
check (deleting the pref gate fails the suppression tests).

## How to apply
Reuse this harness for any new DB-coupled api-server unit test (e.g. the cron
sweeper/pruner). Add table sentinels / chain methods to `test/fakes/db.ts` only
as the new module needs them.

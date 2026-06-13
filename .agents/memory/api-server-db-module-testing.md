---
name: Exercising DB-coupled api-server modules in tests
description: How to run a real-Postgres integration check on an api-server lib that imports @workspace/db, since the native test runner can't load it.
---

The api-server `pnpm test` runner is `node --test 'test/**/*.test.ts'` (native TS).
It can ONLY load self-contained pure modules (e.g. coachBuildSweep.ts,
coachBuildFinish.ts). A module that imports `@workspace/db` or uses `./x.js`
sibling specifiers (resolved by esbuild, not node) will NOT load under
`node --test`:
- `./push.js` etc. resolve to `.ts` only via esbuild, not node's resolver.
- `@workspace/db`'s index does a directory import (`./schema`) that plain ESM
  resolution rejects (ERR_UNSUPPORTED_DIR_IMPORT), so it must be BUNDLED.

**To exercise the real DB-coupled function** (e.g. `sweepAbandonedCoachBuilds`)
against the dev Postgres (`DATABASE_URL` is set in this env): write a small
harness `.ts`, then bundle it with esbuild like the app build but
externalize ONLY pino's transport stack + native pg:
`external: ['pino','pino-pretty','thread-stream','pg-native','*.node','@napi-rs/*']`,
`bundle:true, format:'esm'`, and a banner defining `require/__filename/__dirname`
(pino-pretty's worker needs `__dirname`). Bundling `@workspace/db` is required;
externalizing it reproduces the directory-import crash.

**Why:** the concurrency safety of the sweeper lives in SQL predicates
(buildId-conditional marker delete, dedupe-log claim) that pure unit tests
can't cover — only a real Postgres run does.
**How to apply:** use a synthetic `userId` with NO push_tokens row so the
at-most-once `notif_log` claim is still written (the real at-most-once point)
but no external Expo push fires; the full sweeper scans the whole
`coachBuildPending` namespace, so first confirm no foreign markers exist before
running it against a shared DB.

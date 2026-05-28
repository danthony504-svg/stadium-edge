---
name: api-server dev is one-shot build+start
description: Editing api-server route/source files does not hot-reload — the workflow must be restarted or the endpoint serves stale code.
---

The `@workspace/api-server` dev workflow runs `pnpm run build && pnpm run start` (esbuild one-shot, then `node dist/index.mjs`). It is NOT a file watcher.

**Why:** After editing a server route (e.g. adding markets to `MARKETS_BY_SPORT` in `props.ts`), the running server kept serving the OLD compiled `dist/` bundle, so the live endpoint returned the pre-edit result and looked like the change "didn't work." Restarting the workflow rebuilt and picked it up immediately.

**How to apply:** After ANY edit to api-server source, restart the `artifacts/api-server: API Server` workflow before testing/curling its endpoints. The stadium-edge (Vite) frontend DOES hot-reload, so only the backend needs the manual restart. Also note in-memory `cachedJson` caches reset on restart, so a restart is also the fastest way to bust a stale prop/odds cache during dev.

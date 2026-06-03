---
name: Cross-device sync (saved slips + tracker)
description: How per-user sync works across web/mobile and the clobber-safety rule that makes it correct.
---

# Cross-device sync

Signed-in users sync `savedSlips` (mobile) and `tracker` (web) across devices.
One JSON blob per (Clerk userId, namespace) in the `user_sync` table, served by
`GET/PUT /api/sync/:namespace` (namespace whitelist: `savedSlips`, `tracker`).
Auth is OPTIONAL — signed-out users stay fully local; sync only engages signed in.

- Web = cookie auth (same-origin fetch carries Clerk session, no Bearer).
  Mobile = Clerk Bearer token via `getToken`, attached through `AuthTokenBridge`.

## The clobber-safety rule (don't regress this)
**Rule:** a sync session may be marked "synced" (which is what ENABLES the
debounced push) ONLY after a successful *authenticated 2xx* read. Read helpers
(`getSync`, `fetchServerTracker`) therefore THROW on any non-2xx including 401 —
they must NOT soften 401 into an empty `{data:null}` result.

**Why:** the mobile Bearer token (and web session cookie) is often not ready on
first render. If a 401 is treated as "server is empty", the session gets marked
synced before any real pull, and the next debounced push overwrites the user's
real cloud data with this device's empty/stale local state. A real authenticated
read returning `data: null` genuinely means empty and is safe.

**How to apply:** initial pull lives in a `useEffect`; on failure it does NOT set
the synced ref and schedules a bounded retry (a `pullRetry` state in the deps,
~1.5s backoff, capped ~5). The push effect early-returns until the synced ref ==
current userId. Merge is by id (`mergeSlips`/`mergeTrackers`, keep most-recent).

---
name: Client-side props cache migration on backend market additions
description: When the backend starts shipping a new prop-market family (e.g. quarter/half), in-memory client caches of the props payload survive across the deploy and starve the AI of the new markets until hard refresh. Use a shape-aware staleness predicate + one-shot guard to auto-migrate.
---

# Rule
When the backend props endpoint gains a new market family (quarter/half, alt-spreads, period-totals, etc.) that the chat assistant is then told to pick from, every client-side cache gate on `realPropsByEvent[eventId]` (or equivalent) must be upgraded to detect "pre-new-family" payloads and refetch them — otherwise users with the tab open across the deploy keep getting AI replies like "0 such props available" until they hard-refresh.

**Why:** `realPropsByEvent` is React state, not a fetch cache with a version key. Once an entry is populated it satisfies `if (cache[id])` forever. A backend cache-key bump (e.g. `props-qh:*:v2`) only forces fresh data on the *next* fetch — it doesn't trigger a fetch on its own. The chat prompt then references the stale cached payload and the model honestly reports the markets are missing.

# How to apply
1. Define a `<FAMILY>_SUPPORTED_SPORTS` Set scoped to sports the backend actually returns the new family for (don't include sports the upstream rejects, or you'll loop on them).
2. Write a `isStale<Family>Cache(sport, cached)` predicate that returns true ONLY when: cache is non-empty AND sport is in the supported set AND no row's market matches the new family's suffix/prefix pattern. Anchor regex (`/_q1$/`, not `/q1/`) to avoid catching full-game markets with substring collisions.
3. **One-shot guard is mandatory.** Stamp every successful refetch with `_<family>Checked: true` and short-circuit the predicate when the flag is present. Without this, any `useEffect` that depends on the cache map will loop forever on games where the new-family rows are *legitimately* empty (e.g. game too far out for books to post). Loop pattern: detect stale → fetch → setState with same shape → effect retriggers → detect stale → fetch …
4. Apply the predicate to **every** fetch gate, not just the obvious one. In our codebase there were three: game-detail `useEffect`, chat-time prefetch loop, and the "Build best parlay" path. Grep for every read/write of `realPropsByEvent` before declaring done.
5. Remove any direct state mutation like `realPropsByEvent[id] = data` in the same closure (anti-pattern that pre-dates the cache bug). Use a local `freshlyFetched` variable and read `freshlyFetched || state[id]` to bypass the setState async gap.

# Smell test
If you bump a backend cache key version and the AI still reports the new field as missing for users mid-session, the client cache is the suspect, not the backend.

---
name: Adding analytical signals to the Stadium Edge pick AI
description: How a new data signal flows ESPN -> api-server -> client context -> SYSTEM_PROMPT, plus the auto-serialize shortcut and env/restart quirks.
---

# Wiring a new analytical signal into the pick AI

**The flow (4 hops):** live feed (ESPN/odds) -> api-server route (`artifacts/api-server/src/routes/*.ts`) -> client context assembly in `ParlayBuilder.tsx` `handleSend` -> consumption via `SYSTEM_PROMPT` rule text in `routes/chat.ts`.

**Auto-serialize shortcut — the key labor saver:** the client builds `lockedContext = parsed.data.context` and sends `contextBlock = JSON.stringify(lockedContext)`. So any NEW key you add to the context object is automatically serialized and reaches the model. You do NOT need to touch serialization — you only need to (1) add the key client-side and (2) add a rule paragraph in `chat.ts` telling the model what the key means and how to weigh it.

**Core principle — never fabricate:** only real feed data reaches the model. Honest empty/null buckets are expected and correct — drop a signal (omit the key) when it has 0 games / no data rather than emitting a zero or a guess. Every rule paragraph must end with an explicit "when absent/null, skip this — never invent" clause.

**ESPN data limits worth knowing:**
- ESPN publishes NO opponent-stats-allowed broken down by position (no real defense-vs-position rankings). Only team-level allowed/offensive profile is real. Be honest in the prompt; do not claim "ranks Nth vs the position".
- Player gamelog `atVs` field encodes venue: "vs" = home, "@" = away. Use it to derive home/away splits.

**Per-prop dedup gotcha:** `playerTargets` dedupes by `athleteId` (`seenAthletes`), so each player gets exactly ONE context entry even across a doubleheader — the first prop encountered wins its opponent/venue. Signals keyed by player (playerHistory, mlbPlatoon) inherit this; it's a known, accepted limitation, not a bug to "fix" per signal.

**Venue-correct split:** capture `isHome` per prop (playerTeamId === home team) and preselect a `tonightSplit`/`tonightVenue` client-side so the model isn't left to infer venue. Still send raw homeSplit/awaySplit as fallback.

## Env / build / restart quirks
- **api-server has NO file watcher.** After ANY backend edit you MUST restart the `artifacts/api-server: API Server` workflow — it rebuilds then starts (one-shot). HMR will NOT pick up route/prompt changes.
- **stadium-edge `vite build` reads `PORT` and `BASE_PATH` at config-load time** and throws before compiling if either is missing. To validate a production build run: `PORT=5000 BASE_PATH=/stadium-edge pnpm --filter @workspace/stadium-edge run build`.
- `ParlayBuilder.tsx` is large untyped JSX (~10k lines); `tsc` has many pre-existing errors there. Use the vite build (not tsc) to confirm the client compiles.
- Client reaches the api via relative `/api/sports/*` paths, proxied at the platform level (not in vite.config.ts). Don't expect an `/api` proxy block in the vite config.

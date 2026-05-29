---
name: Props empty when odds came from a fallback source
description: Why "no player props are up" happens for a real game that HAS props, and the team-name event-id resolver that fixes it.
---

# Props arrive empty when game odds came from a FALLBACK source

## Symptom
User names a real game ("best 10-leg parlay for Spurs @ Thunder") and the AI
builds game-level legs (ML/spread/total) but reports "no player props are up" —
even though the Odds API HAS props for that game.

## Root cause
The props endpoint (`/api/sports/props`) queries the Odds API **per-event**
endpoint, which only accepts an **Odds API event id** (32-char hex). The client
builds its prop-fetch candidates from `realOddsBySport[sport][].id`. When the
**primary** Odds API bulk-odds fetch (`/api/sports/odds`) is rate-limited, the
client falls back to `/api/sports/odds-espn` then `/api/sports/odds-bovada`
(see the `tryFetch` chains in ParlayBuilder). Those fallback routes stamp each
game with their OWN id — ESPN emits `id: e.id` (numeric ESPN event id), Bovada
emits a Bovada id. Feeding that non-Odds-API id to the props endpoint → upstream
**422 INVALID_EVENT_ID** → empty props → the honest-but-wrong AI message.

Game-level legs still render because they come straight from the fallback odds
(which DO carry ML/spread/total), so the failure looks like "props specifically
are missing" rather than "the whole game is missing".

**Why the 429-retry fix did NOT cover this:** for a single named game there is
only ONE prop fetch (no burst), and the failure is a deterministic 422 from a
wrong id, not a transient 429.

## Fix
Resolve the REAL Odds API event id from **team names** server-side.
- Client passes `home` & `away` full team names on every `/api/sports/props`
  request (from the odds entry's `homeTeam`/`awayTeam`).
- Server: if `eventId` isn't 32-hex AND home+away present, hit the Odds API
  **free** events endpoint (`/v4/sports/{key}/events`, 0 quota credits, cached
  `odds-events:{key}` 5 min) and match by **nickname** (last alpha word),
  orientation-agnostic (ESPN/Bovada home/away can be flipped vs Odds API).
  Use the resolved id for the fetch URL AND the `props:`/`props-qh:`/`props-alt:`
  cache keys so resolved props cache correctly.
- Client keys `extraProps` / `eventToStart` / `eventToGame` by the CLIENT's
  eventId throughout, so the server's internal resolution stays invisible — no
  downstream map mismatch.

**Why:** props must survive the odds-source fallback; an id from ESPN/Bovada is
useless against the Odds API, but the team names always match across sources.

**How to apply:** any new per-event Odds API call that gets its id from
`realOddsBySport` must tolerate a fallback (non-hex) id by resolving via names,
or it silently breaks whenever the primary odds feed is rate-limited.

## Test (proves it)
`/api/sports/props?sport=nba&eventId=401766999` (bogus ESPN-style id, no names)
→ 422. Add `&home=Oklahoma City Thunder&away=San Antonio Spurs` → resolves and
returns ~660 props. api-server has no watcher — restart after editing props.ts.

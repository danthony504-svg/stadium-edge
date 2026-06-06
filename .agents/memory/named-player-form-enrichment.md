---
name: Named off-slate player form enrichment (mobile chat)
description: How the mobile Coach gives a real recent-form read for players the user names who aren't on tonight's slate.
---

# Named off-slate player form enrichment

When the user NAMES players for a form/HR read and they're NOT in tonight's prop
pool, the mobile Coach chat path now injects their REAL recent game log so the
model gives a grounded recent-form read instead of refusing or fabricating.

**Why:** the single-player stat-card path (`tryStatCard`/`parseStatLookup`)
extracts only ONE name, so MULTIPLE comma/"and"-separated names (the common
"Seager, Pederson, Nimmo hr" shape) return null and fall through to the chat
path with no data — the gap this fills.

**How to apply:**
- Lives in `buildChatContext` (stadium-mobile/lib/api.ts), AFTER the pool
  `playerHistory` build, BEFORE the mlbPlatoon block. Mobile-only (web
  ParlayBuilder has the same gap — parity TODO).
- Gated to `!isBuild && hasFormCue` so it never runs on parlay builds.
- `extractNamedCandidates()` splits on list delimiters, strips request/stat/
  filler words (NAME_REQUEST_FILLER) — deliberately keeps will/may/cam — yields
  1–3 token names, ≤6.
- Each candidate is resolved via `searchPlayer` with an accent-insensitive
  WHOLE-WORD guard; SINGLE-token (surname-only) candidates additionally require
  `isActive` AND the token to be the player's first/last name (kills retired
  namesakes + middle-name accidents — the architect's main risk). Multi-token
  names are trusted as specific.
- Injected entries carry `recentFormOnly: true`. Server SYSTEM_PROMPT
  (chat.ts, PLAYER-PROP ANALYTICS RULE) documents it: recent-form read only,
  say they're off-slate, never invent game/park/matchup/platoon/line, NOT a PICK
  line. Prompt change needs an api-server RESTART (no watcher).
- Safe vs the single-game-lock playerHistory trim (chat.ts ~1090): that trim
  only runs when a GAME is named; a multi-name player question names no game.
- Never fabricates: every value is a real ESPN game log; unresolved/over-broad
  candidates (e.g. "padres") simply fail the search/guard and are dropped.

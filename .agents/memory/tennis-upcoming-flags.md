---
name: Tennis Upcoming country flags
description: How tennis Upcoming GameCards get a real avatar when there's no team crest/headshot.
---

# Tennis Upcoming country flags (mobile)

Tennis players aren't ESPN teams, so `/sports/games` returns [] for tennis →
the mobile metaMap is empty → Upcoming GameCards fell back to plain initials.

**Decision:** ESPN tennis competitors carry NO headshot and NO athlete id, but
DO carry a real country flag (`competitor.flag.href` PNG + `flag.alt` country).
Show that flag as the card avatar; fall back to initials when ESPN has none.
Never guess a flag (honesty rule).

**Why:** it's the only REAL per-player image ESPN exposes for tennis.

**How to apply / shape:**
- Server (api-server tennis.ts): `loadTennisFlags()` reuses `loadScoreboard`,
  returns `Record<normName,{displayName,country,flag}>`; route `GET
  /sports/tennis-flags` (rate-limited, `{}` on error). api-server has NO watcher
  → restart workflow after edits.
- Client (stadium-mobile lib/api.ts): `getTennisFlags`, `normTennisName`
  (lowercase/NFD-strip-diacritics/non-alnum→space, mirrors server), and
  `resolveTennisFlag` = full normName match → unique-surname fallback → null on
  ambiguous/missing (the non-guessing guarantee).
- UI: a `withTennisFlags(base, flags, game)` helper merges flag URLs into
  GameCard `meta.awayLogo/homeLogo` (GameCard already renders a uri or initials,
  so no GameCard change). Wired into BOTH `app/(tabs)/index.tsx` (Home Upcoming
  rail) and `app/upcoming.tsx` (View-all), gated to `sport === "tennis"`, query
  `enabled` only for tennis. Client change needs OTA/new build to reach
  installed app.

---
name: Coach matchup lookahead horizon (playoff series questions)
description: Why the Coach couldn't answer "what did we learn last game for the next game" on a playoff series, and the focal-only horizon widening that fixes it.
---

# Coach matchup / last-meeting lookahead horizon

The mobile (and web) Coach context is built around the betting window: `isPickable()` = a game within `now-4h .. now+48h`. The odds pool AND the matchup-history target pool both inherit that gate.

**Symptom:** "What did you learn about the NBA Finals Game 2 that helps Game 3?" → Coach says the matchup "isn't loaded" (only the sports with games inside 48h show up). The NEXT playoff game is often 2-3 days out (beyond 48h) and frequently has NO posted odds yet, so it never enters `realGames`/`historyTargets` → no `matchupHistory`/`lastMeeting` for it → honest "not loaded".

**Fix (focal-only, bounded):** in `buildChatContext` (mobile `lib/api.ts`), when the user NAMES a sport/game (`focalText` → `focalSportsFromText` / `gameMatchesFocalText`), allow that focal sport's upcoming non-final games a WIDER horizon (`withinFocalHorizon` = now+8 days) into `realGames` + `historyTargets`. Bounded by `focalExtra < 6` per sport (plus the existing `perSport < 12` history cap and global `slice(0,16)` fetch cap). Non-focal sports keep the 48h gate. These extra games carry NO odds (`realOdds` stays 48h-gated) — they exist purely for the matchup/last-meeting read.

**Why bounded to focal:** widening the horizon for ALL sports bloats `realGames` (MLB alone is 100+ games over 8 days; `realGames` push is uncapped). Focal-only + `focalExtra` cap keeps it targeted.

**Prompt side (api-server `chat.ts`):** added "NO ODDS REQUIRED for a matchup read" — answer from `matchupHistory`/`lastMeeting`/`h2h` even when the game has no `realOdds`; never say "not loaded" when matchupHistory is present. Also carved an exception into the "arrays are pre-filtered to 48h" rule: a focal matchup game may appear in `realGames` past 48h for ANALYSIS ONLY — still NOT a pick-eligible betting leg (the >48h `startsAt` HARD RULE keeps it out of tickets).

**Reach note:** this is a CLIENT-side (mobile bundle) change — needs an OTA (`eas update`) to hit an installed app; the server prompt change ships with an API publish. EAS update CANNOT run from the Replit sandbox (hangs on network/fingerprint at ~0.2% CPU); user must run `pnpm --filter @workspace/stadium-mobile run update:ios` from their own Mac.

## Fallout: stale Metro bundle after the rename
The new focal-horizon block first reused an existing local name (`focalSports` already declared later in buildChatContext for odds ranking). tsc caught it; renamed mine to `focalSportsHist`. BUT Metro had already bundled the broken intermediate (duplicate-identifier SyntaxError at the SECOND declaration) and is lazy — it kept serving that crash bundle to the connected phone (ErrorFallback "Something went wrong / Try Again") even after the source was fixed. Fix = restart the `stadium-mobile: expo` workflow so Metro re-bundles; phone then just needs a reload. Lesson: a transient redeclaration that tsc later passes can still be cached by Metro — restart expo after any mid-edit syntax error, don't trust that the phone picks up the corrected source on its own.

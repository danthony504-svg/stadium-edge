---
name: Slip prop teamAbbr can be wrong
description: Why AiPickCard prop subtitles show the matchup, not a lone team code
---

# Slip AI-card prop subtitle: matchup, not lone team code

A player prop's `ParsedPick.teamAbbr` is resolved from the **props feed's `playerTeamId`** (via `teamMetaById` in `lib/api.ts`) and can mis-resolve to the wrong club — observed: NY Knicks players (Brunson, Hart) tagged **"NO"** (New Orleans). Rendering `${teamAbbr} · ${market}` then both lied AND read like the negation "NO POINTS / NO REBOUNDS".

**Rule:** In `AiPickCard` (slip + game-detail), props render `AWAY @ HOME · MARKET` (from ESPN `gameMeta` abbrs) or just `MARKET` when the game isn't in the slate — never the lone `teamAbbr`. Game (ML/spread) legs keep `teamAbbr`-first (a side-pick has a definite team). `enrichPickMeta` no longer early-returns for props; it attaches `awayAbbr/homeAbbr` only (never logos, so headshot stays the avatar) and is idempotent.

**Why:** ESPN matchup abbrs are reliable; the per-player prop team code is not. Robust either way — even if `teamAbbr` were right, the matchup avoids the "NO POINTS" negation read.

**How to apply:** Never surface a prop's lone `teamAbbr` in UI. The chat `PickCard` already shows the matchup (MatchupLine), so it was unaffected — only `AiPickCard` had the bug.

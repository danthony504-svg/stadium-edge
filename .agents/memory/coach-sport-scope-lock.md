---
name: Coach sport-scope lock
description: Why a league-scoped parlay ("all nba games") could leak other sports, and the two-layer fix that keeps every leg inside the named league.
---

# Sport-scope lock (no cross-sport padding)

A league-scoped parlay ask — "all nba games", "nba only", "tonight game 3" when
the user means one league — could come back with **other sports' legs** padded in
to hit the requested leg count (e.g. a 15-leg NBA ask returned MLB alt
spreads/totals mixed with NBA props). The MLB legs carried full AI grades, which
proves the **model itself** generated them (not a client backfill).

**Why it happened:** `chat.ts` SYSTEM_PROMPT had GAME-LOCK (single named game),
ALL-GAMES, and N-leg sizing rules, but **no SPORT-SCOPE rule**. With no single
game named, "all nba"/"game 3" left the model free to widen across sports to
reach N.

**Fix — two layers (defense in depth):**
- **Prompt (primary):** a `SPORT-SCOPE LOCK, STRICT` REQUEST-TYPE rule, placed
  right after GAME-LOCK. When the user constrains to one league in this OR a
  recent message, every leg must come from that sport; never widen to another
  sport to hit N; honest-short with one note if the league can't supply N.
  GAME-LOCK still wins if a specific game is also named.
- **Client backstop (mobile coach.tsx plain-N deterministic backfill):** make the
  backfill `pool` sport-aware so it can't re-pad other sports after the prompt
  shortens the model output. Lock to (a) sports named in the **current** message
  via `focalSportsFromText`, else (b) the sport shared by **2+** resolved legs
  (mirrors the existing single-game lock + market-family lock). A **lone** leg
  does NOT establish a lock, so generic N-leg asks still fill across the board.

**How to apply / gotchas:**
- `focalSportsFromText` (lib/chatContextPriority.ts) deliberately **omits
  ambiguous terms** like "basketball"/"football" because they span multiple
  leagues (nba/wnba/ncaab). So any prompt EXAMPLE you cite as a trigger must use
  **unambiguous league tokens** the helper actually recognizes (nba, wnba, mlb,
  nhl/hockey, …) — don't write "just basketball tonight" as a documented trigger
  or the deterministic client backstop won't match it.
- Over-restriction is acceptable: if 2+ generic legs happen to share a sport, the
  backfill sport-locks — functionally safe (no fabrication), only mildly narrows
  variety, same property as the existing market-family lock.
- The inline backfill lock isn't unit-testable (coach.tsx imports expo/fetch, can't
  load under `node --test`); `focalSportsFromText` itself is covered in
  chatContextPriority.test.ts.
- Mobile JS change → OTA-unsafe; ships in the next native build, not `eas update`.
- api-server has no watcher — restart it after any prompt edit.

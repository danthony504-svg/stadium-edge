---
name: Player stat-lookup name extraction
description: Why parseStatLookup needs both a projection-word strip and a span-search fallback, and the "Will Smith" trap.
---

# Player stat-lookup name extraction (ParlayBuilder.tsx)

`parseStatLookup(text)` pulls a player name out of a free-form stat question by
regex-stripping filler, then `handleSend` resolves it via `/api/sports/player-search`
(ESPN). The not-found message ("I couldn't find a player named …") fires when that
resolution misses on a cued (non-bareName) lookup.

## The two hard constraints
- **ESPN player-search is STRICT.** Any residual non-name token returns ZERO results.
  `"wembanyama"` → Victor Wembanyama, but `"wembanyama will"`, `"wembanyama score"`,
  `"lebron james will"` all → `[]`. So the extracted name must be essentially clean.
- **Regex stripping alone is whack-a-mole.** Forward-looking ("how many points do you
  think X will score Wednesday") and descriptive ("X will dominate") phrasings leave
  words next to the name, and a leftover like `wednesday`(9)/`dominate`(8) can be LONGER
  than the surname — so "pick the longest token" is also unreliable.

## The fix = two layers (both in ParlayBuilder.tsx)
1. **Projection/opinion + weekday strip** in `parseStatLookup`: removes never-a-name
   words (you/we/they/he/she/it, think/believe/expect/predict/guess, would/should/could/
   gonna/going, monday-sunday).
2. **Span-search fallback** in `handleSend`, gated `if (!top && !lookup.bareName)`: retry
   ESPN with contiguous token sub-spans (len 3→1, left→right), skipping pure-filler tokens
   via `NAME_FALLBACK_SKIP`, first hit wins. Guard each hit: candidate must appear in the
   resolved name (accent-normalized) so ESPN's fuzzy single-token search can't bind a stray
   token to the wrong athlete.

## The "Will Smith" trap — DO NOT blanket-strip these
`will`, `cam`, `may` are real player names (Will Smith MLB, Cam Thomas NBA). Never put them
in the PRIMARY strip. Instead put `will` in `NAME_FALLBACK_SKIP` only — it's skipped as a
*standalone fallback candidate* (so `"wembanyama will"`→`"wembanyama"`) while the primary
`"Will Smith"` search is untouched.

**Why:** without layer 2, every phrasing whose surname isn't already perfectly isolated
re-introduces the bug; without the Will-Smith carve-out, fixing the bug breaks real names.
Verify against the LIVE api-server (ESPN behavior can't be mocked) — replicate parseStatLookup
+ fallback in a node script and assert resolved player names.

## Period questions WITHOUT "game by game" → real splits, not the full-game note
A period ask alone ("how many points will X score in the FIRST QUARTER") used to require
ALSO matching perGameAsk ("game by game") to hit `/api/sports/statmuse-gamelog`; otherwise it
fell to the ESPN full-game card + honest "no period splits" note. Now, after the player
resolves to a real ESPN player (`top`) and BEFORE the full-game history fetch, an
`if (lookup.period)` branch builds a CANONICAL query `"<top.name> <periodPhrase> <statWord>
last 10 games"` (period/stat normalized CLIENT-side, not the raw user text) and renders the
real per-game `PeriodGameLogCard`. On any StatMuse miss it falls THROUGH to the full-game
card — so it never fabricates a period number.
**Why canonical client-side query, not raw text:** the raw projection phrasing ("do you
think … wednesday") contaminates StatMuse's headline player-resolution; feeding the clean
resolved name + canonical phrasing reliably returns the per-game grid.
**Scope:** only sports StatMuse has period box scores for (NBA quarters/halves, NHL periods).
MLB innings aren't mapped by the client period normalizer → skips → full-game fallback. Fine.

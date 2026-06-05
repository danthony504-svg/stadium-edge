---
name: Focal-sport/game realOdds float
description: Why the mobile Coach's realOdds cap truncates a named game's markets, and the float fix
---

# Focal-sport/game realOdds float (mobile Coach)

The mobile Coach's `buildChatContext` builds `realOdds` by iterating **all** sports
(`DEFAULT_SPORTS`) in array order, then caps the flat list (`realOdds.slice(0, CAP)`).
Because MLB iterates first and a nightly MLB slate alone emits enough main+alt entries
to overflow the cap, a lone game in a later sport (e.g. a single NBA game) gets its
odds — including game-level period markets (`h2h_q1/spreads_q1/totals_q1`) — sliced
off entirely. The game still appears in `realGames` (the matchup list), so the model
sees the matchup but **zero realOdds for it** and honestly refuses ("no posted
realOdds / 0 qualifying legs") even though the live feed is fully priced.

**Rule:** any cap over a flat all-sports `realOdds`/`realProps` pool must FLOAT the
league/game the user named to the front *before* slicing. Pass the user's message
(`focalText`) into `buildChatContext` and rank entries: named-game token match >
named-sport keyword match > original order (stable). Raise the cap when
`includePeriods` (period asks emit many game-level legs per game).

**Why:** the same class of bug as the realProps float (`focal-prop-float.md`) — a
nondeterministic/iteration-order pool truncated by a fixed cap silently drops the one
thing the user asked about. Float, don't just raise the cap (multi-sport slates can
overflow any cap).

**How to apply:**
- Sport detection: whole-word regex on a curated keyword map; `\bnba\b` does NOT match
  `wnba` (no boundary inside the token) — relied on, keep it. Omit ambiguous terms
  like "football" (spans NFL/CFB/soccer).
- Game detection: alphabetic tokens len>=5 from the game label (skips "san"/"new"/"los").
- Generic asks (no sport/team named) produce all-zero scores → stable sort is a no-op →
  no regression; default cap stays 120.
- Honesty boundary unchanged: NBA Q1 **player props** legitimately don't exist in the
  Odds API, so the honest best outcome for a single-NBA-game Q1 ask is a ~3-leg
  same-game parlay (Q1 ML + Q1 spread + Q1 total), not a fabricated 6.

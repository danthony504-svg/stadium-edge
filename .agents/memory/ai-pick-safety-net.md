---
name: AI-emitted pick safety-net (post-parse HARD BAN enforcement)
description: Why prompt-only HARD BAN enforcement fails in scarcity tickets and how to back it with a deterministic post-parse filter.
---

When the AI generates PICK lines for a parlay, the prompt's HARD BAN rules (no duplicate market×period×game family; no anti-correlated ML+opposite-team-spread) get dropped under scarcity pressure or in long contexts. Back them with a deterministic post-parse filter on the client that drops violators, scrubs their raw lines from the displayed message, and surfaces a transparent note explaining what was dropped.

**Why:** Users notice when "Over 218.5 + Over 219.5" or "Thunder ML + Spurs -4 same game" ships. Prompt language alone never gets to 100%. A 30-line post-parse filter catches every miss with zero AI cooperation. Be transparent: don't silently drop — name the reason so the user trusts the system.

**How to apply:**
- Run the filter AFTER PICK-line parsing and BEFORE the slip/text-render writeback. Track each parsed pick's raw line text so you can strip it from the displayed AI message exactly once (the prose narrative already references it).
- Family/period detection: strip the `^(1H|2H|Q[1-4])\s+` prefix to find the bare market, classify into ML / SPREAD / (Alt) Spread / TOTAL / (Alt) Total. Period defaults to "FG" when no prefix. Dedup key = `${game}|${period}|${family}`. Player props don't collide — skip them.
- Side resolution must NOT be raw string equality. "Oklahoma City Thunder ML" vs "Thunder -4" share zero raw tokens after stripping "ML". Instead: split the game label into away/home team tokens (length > 2), tokenize the pick string the same way, and assign `away`/`home` based on which side matches. Refuse to claim a side when ambiguous (shared token) or no match — false-positive anti-correlation over-strips valid pairs.
- Numeric parsing must normalize Unicode minus / en-dash / em-dash to ASCII hyphen before regex — models occasionally emit `−4` (U+2212) and the rule silently misses.
- Anti-correlation threshold for FG ML + opposite-team FG (Alt) Spread: drop only when the spread point ≤ −2.5 (small dog / pickem still survivable when ML team wins by 1-2).
- Drop the WORSE-priced leg (more negative American odds). Guard against non-finite odds (PrizePicks legs have `odds: null`) with a deterministic tie-break — otherwise NaN comparisons leak.
- PrizePicks token checks must be case-insensitive (`/^PrizePicks line$/i`) — same regex flag that parses the PICK line. Mixed casing otherwise routes a DFS leg into the side-market dedup path with NaN odds.
- Transparency note format: append `_(Dropped N legs that would have built a contradictory ticket (reason; reason).)_` to the cleaned message. De-dup reasons so the same family-collision doesn't list twice.

---
name: MLB batter-vs-pitcher (BvP) real signal
description: How real career batter-vs-specific-pitcher lines reach the pick AI via StatMuse, lifting a deliberate never-fabricate ban — plus the entity/diacritic guard and shared-budget gotcha.
---

# MLB batter-vs-pitcher (the one matchup factor platoon can't capture)

The platoon signal (`mlbPlatoon`) only knows batter HAND vs pitcher HAND + season
splits — NOT how this exact hitter has done vs this exact pitcher. That true BvP
career line was historically **banned** by the MLB NEVER-FABRICATE CLAUSE in
`chat.ts` because no feed carried it (no Statcast/Savant). StatMuse DOES answer it
("Freddie Freeman .340 with a homer in 55 PA vs Logan Webb"; "Yandy Díaz 2-for-12
in 12 PA vs Skubal"), so it's now a REAL signal.

**Rule:** a factor moving from "banned/fabricated" to "supported" requires BOTH a
real source AND amending the never-fabricate clause in lockstep — otherwise the
prompt keeps telling the model the data doesn't exist. (See
betting-signal-data-boundary.md — this is the sanctioned way to add a previously
unsupported signal: find a real feed first, never just prompt it in.)

## Wiring (server-side, NOT client)
- No client change needed: `mlbPlatoon` (built in ParlayBuilder) already carries
  `player` + `opposingPitcherName` per batter. The BvP fetch lives in `chat.ts`
  inside the best-effort StatMuse enrichment block and reads `context.mlbPlatoon`.
- For up to 6 batters (prefer ones NAMED in the message, else the whole pool),
  `askStatMuse("<batter> career vs <pitcher>", "mlb")`. Inject as
  `lockedContext.mlbBatterVsPitcher = [{ batter, pitcher, line, pa }]`.
- Prompt: `MLB BATTER-VS-PITCHER RULE` weights by sample size (pa<~20 = minor
  anecdote only, say "small sample"; pa>=~20 strong/weak line = real tilt), and
  the never-fabricate carve-out: cite ONLY lines present in that array.

## Two non-obvious gotchas (both caught in review)
1. **Entity guard MUST be diacritic-insensitive.** StatMuse can resolve an
   ambiguous name to a DIFFERENT player and still return a counted line, so we
   require the answer text to contain BOTH the batter and pitcher surnames before
   trusting it. But StatMuse returns accented names ("Yandy Díaz") for an
   unaccented query ("Yandy Diaz") — a naive surname match false-DROPS the real
   row. Normalize NFD + strip `\u0300-\u036f` on BOTH sides, and strip suffix
   tokens (jr/sr/ii…) when picking the surname.
2. **Shared deadline pass.** StatMuse enrichment has a ~3s budget. Resolving BvP
   in a SECOND `await Promise.all` after the facts await stacks the ceiling to
   ~6s. Resolve facts + BvP in ONE `Promise.all([...])` so both deadline timers
   start together.

## Sample acceptance
Keep a row ONLY when a real PA/AB count parses
(`/([\d,]+)\s+(?:plate appearances|pa|at[-\s]?bats?|ab)\b/i`). "Never faced" /
count-less answers carry no signal → drop (askStatMuse already nulls boilerplate).

## What is NOT buildable honestly (told the user)
Basketball positional-defense matchups ("center vs shooters", "bad shooter → more
rebounds", per-position turnover/rebound rates) are NOT a real feed — ESPN has no
defense-vs-position splits (see opponent-defense-route.md). The existing
team-defense + pace + rest signals already cover game-FLOW reasoning; do NOT
fabricate per-position matchup numbers.

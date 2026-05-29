---
name: Alternate prop-line ladders
description: How real bookmaker alt prop rungs are fetched, folded, trimmed, and surfaced to the AI for cushion/value swaps.
---

# Alternate prop-line ladders (cushion / value swaps)

Real Odds API alternate player markets (`*_alternate`) give a LADDER of rungs around
each main prop line so the AI can offer a safer "cushion" rung or a plus-money
"value" rung — using ONLY real rungs, never fabricated.

## Fetch
- `ALT_MARKETS_BY_SPORT` in `props.ts` lists the documented `_alternate` keys per
  sport. Probe any NEW key on a live event first — the alt batch is **all-or-nothing**:
  one unsupported key 422s the whole batch.
- Fetched as a SEPARATE cached call (`props-alt:<key>:<eventId>:v1`) inside the same
  `Promise.all`, wrapped in try/catch → null. A 422 must NOT wipe base/QH props
  (same caveat as QH markets).

## Folding + trimming (the important invariants)
- An `ingest(src, isAlt)` helper strips the `_alternate` suffix so each rung folds
  into the SAME `(player, market)` bucket as the main line at different `line` values.
- **Ingest mains BEFORE alts.** A rung that also exists as a real main line must stay
  main: `if (!isAlt) row.alt = false` guards this. Each row carries an `alt` boolean.
- Trimming keeps alts only if over OR under price ∈ [-600, 600], grouped by
  `player|market`, sorted by distance from the main line, capped 6/group
  (`ALT_CAP_PER_PM`).
- **Output order = mains first, then trimmed alts.** Downstream slice caps
  (realProps 200/event, 400 total) therefore drop alt rungs before any main line.

## Surfacing to the AI
- Client `ParlayBuilder.tsx` realProps push forwards `alt: pr.alt === true`.
- `chat.ts` SYSTEM_PROMPT "PROP-LEVEL alts" section teaches cushion (lower-Over /
  higher-Under, safer) vs value (higher-Over / lower-Under, plus money) directions,
  with HARD RULES: only pick a rung that exists in realProps, never worse than -1000,
  analytics justification still required.
- **Gotcha:** the period-intent fresh-fetch fallback in `chat.ts` rebuilds prop rows
  field-by-field (does NOT spread the whole row), so it must explicitly copy `alt`
  (and `startsAt`) or those rungs lose their identity on that path. Any future field
  added to the props payload needs the same treatment in that reconstruction.

## Known residual limitation (follow-up, not done)
- Prop-leg existence is enforced by PROMPT only — there is no deterministic post-parse
  validator that rejects an AI-emitted prop whose (player, market, line, side, price)
  isn't in realProps. This predates alts and applies equally to main lines. A hard
  realProps-matching scrub would be the real fix.

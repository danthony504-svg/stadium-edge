---
name: Game-level period markets in chat context
description: Why single-game parlays collapsed to 1 leg — period markets are fetched + prompt-documented but must be emitted client-side by buildPicksFromOdds
---

# Game-level period markets only reach the AI if buildPicksFromOdds emits them

A single-game ("game-locked") parlay request collapsed to ~1 leg because a game's
full-game ML/Spread/Total are mostly correlated/duplicate-banned among themselves,
so there were too few INDEPENDENT full-game families to satisfy the requested count.

**The trap:** three layers gave a false impression that game-level period markets
already worked:
- `odds.ts` DOES fetch them (`PERIOD_GAME_MARKETS`: `h2h_q1..q4`, `spreads_q1..q4`,
  `totals_q1..q4`, `*_h1`, `*_h2`, `alternate_spreads_h1`, `alternate_totals_h1`)
  and ships them in each game's `markets[]` as raw keys.
- `chat.ts` SYSTEM_PROMPT DOCUMENTS them as present in `realOdds` with friendly
  labels ("1H Spread", "Q3 Total", "Q2 Moneyline", "1H Alt Spread", "1H Alt Total").
- the chat safety-net `familyOf`/`periodOf` already parse that label format.
But the CLIENT's `buildPicksFromOdds` only translated full-game `h2h/spreads/totals`
+ `alternate_spreads/alternate_totals`. It NEVER read the period keys, so they never
entered `realOdds`. (The older "period-intent / SGP period lever" memory was about
player props `_q1`/`_h1` via props.ts — NOT game-level period legs.)

**Why:** the chat context (`realOdds`) is built entirely client-side from
`buildPicksFromOdds`. If a market isn't emitted there, the AI cannot use it no
matter what the prompt claims.

**How to apply:**
- `buildPicksFromOdds(g, includePeriods=false)` emits period legs only when asked.
  Default false keeps slip-render / detail-card / individual-game callers unchanged.
- The realOdds context builder turns periods ON only for a NAMED single game OR
  explicit period/sgp intent — otherwise multi-game context explodes (~46 period
  picks/game). Named-game legs are accumulated FIRST so `realOdds.slice(0,120)`
  never truncates the deep single-game set; per-game period cap 60 (named) / 12 (broad).
- Emit labels EXACTLY as `<period> <type>` ("Q1 Total", "1H Spread", "Q2 Moneyline",
  "1H Alt Spread", "1H Alt Total") so `periodOf`/`familyOf` treat each period as a
  distinct non-duplicate family and the PICK parser/renderer stay uniform.
- **Anti-correlation must be period-SCOPED, not FG-only.** Once period legs are
  exposed, the ML-vs-opposite-spread anti-correlation pass must compare legs that
  share the SAME period (FG/1H/2H/Q1-Q4); an FG ML and a Q1 spread settle on
  different windows and are NOT mutually exclusive. Leaving it FG-only lets
  contradictory same-period combos (Q1 ML A + Q1 spread B -2.5) survive.

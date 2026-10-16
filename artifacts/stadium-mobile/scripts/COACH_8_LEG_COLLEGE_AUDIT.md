# Coach audit — exact ask `8 leg college`

**Date:** 2026-10-16  
**Constraints:** Voice paused; no publish / deploy / production OTA.  
**Protection:** `NCAAF_GAME_LINE_SIM_VALIDATED=false` stays armed until Phase E validation supports enabling it.

## Stage funnel (ask-only path)

| Stage | What happens for `8 leg college` | Count / outcome | Rejection / gate |
|-------|----------------------------------|-----------------|------------------|
| 1. Parse sport/market scope | `askIsCollegeFootballOnly` → true; bare `college` focal → `ncaaf`; `wantsGameLinesOnlyAsk` → `gameLinesOnly=true`; props mix off | sports=`["ncaaf"]`, legs=8, propsOnly=false, gameLinesOnly=true | College player props **unavailable on bare ask** (team markets only). Ambiguous college → clarification note (FB vs BB), default CFB. |
| 2. Provider board | Ask-only P0 early exit **before** `loadScanInputs` | odds/prop fetch **skipped** (0 games loaded on this path) | Would have been NCAAF team markets only if scan ran. |
| 3. Normalized candidates | N/A on early exit; board-level belt would mark every FG side/total P0 | candidateCount → 0 seated | `unvalidated_ncaaf_game_line_simulation` / totals P0 |
| 4. Simulation | Slate Monte Carlo **not started** | gameSimsLoaded=0, gameSimsAttempted=false | `NCAAF_GAME_LINE_SIM_VALIDATED=false` |
| 5. Qualification | No scored legs | qualified=0 | Gate, not quality-bar grading |
| 6. Final delivery | Empty ticket + clarification + blocked-sim note | picks=0 | Note must **not** say “cleared the quality bar” |

## Did `NCAAF_GAME_LINE_SIM_VALIDATED=false` cause the empty result?

**Yes.** Bare college → game-lines-only + NCAAF lock. With the flag false, `ncaafGameLineAskIsP0Blocked` is true, so Coach exits before board load/sims and returns 0 legs. That is intentional fail-closed protection, not a quality-bar miss.

Keep the flag **false** until `ncaafGameLineSimValidation` + human Phase E sign-off.

## Unavailable college player props vs supported team markets

| Surface | Bare `8 leg college` | Explicit props ask (`… player props` / yards / TDs) |
|---------|----------------------|------------------------------------------------------|
| Team markets (spread / ML / total / periods) | In scope, but **P0-blocked** while unvalidated | Not required |
| College player props | **Not loaded** (`gameLinesOnly`; `askAllowsNcaafPlayerProps=false`) | Eligible; P0 game-line gate does not block props |

## Ambiguous “college”

`isAmbiguousCollegeSportAsk("8 leg college")` is true. User note clarifies football (NCAAF) vs basketball (NCAAB) instead of silently selecting CBB. Board still defaults to NCAAF team markets for continuity.

## Copy fix

Blocked / missing simulation paths use `p0BlockedNcaafGameLineAskNote` / `p0BlockedGameLineBoardNote` (+ optional `bareCollegeClarificationNote`). These explicitly state unvalidated / blocked simulation — not “picks failed the quality bar.”

Failure code for board-level full P0: `P0_UNVALIDATED_MARKETS` (logs/manifest only; sanitized out of chat).

## Regression

`lib/coachEightLegCollegeAudit.test.ts` — exact ask coverage for parse, ambiguity, flag, note, and buildParlay gate ordering.

## Related prop-context audit

Continues in `PROP_CONTEXT_PIPELINE_AUDIT.md` (opponent D / weather / field / injury). No publish/deploy for either track.

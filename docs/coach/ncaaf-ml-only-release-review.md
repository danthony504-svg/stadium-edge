# ML-only release review — clean E1 α=1.15

**Generated:** 2026-10-17T14:09:36.443Z  
**Candidate preserved:** yes · **Retuned vs FINAL_EVAL:** no  
**Verdict:** `ML_METRICS_CLEAR_E4_BLOCKER — do not request E6`

## Markets

| Market | Status |
|--------|--------|
| Moneyline | under review (M1–M4 + C1–C6 measured) |
| Spreads | **BLOCKED** |
| Totals | **BLOCKED** |
| ALTs | **BLOCKED** |

## Supported-matchup exclusions

| Item | n / IDs |
|------|---------|
| Membership | 408 |
| Paired ML cohort (scored) | 403 |
| Empty-bookmaker MISSING_DATA | 5: 401756933, 401752886, 401752771, 401752776, 401754604 |
| Unscored vs membership | 5 |

- Supported ML eval cohort = rematched two-sided close/early joins (403)
- 5 empty-bookmaker shells explicitly MISSING_DATA (not scored)
- FBS–FCS / unrated withholds: none on scored 403 (harness withhold empty)
- Spreads / totals / ALTs out of scope (blocked separate gates)

## Measured FINAL_EVAL results (frozen)

**Stamp:** `ncaaf-score-margin-v1-research` · **α=1.15** · coverage 403/408

### M1–M4
| # | Pass | Measured |
|---|:----:|----------|
| M1 | true | nMl=403 |
| M2 | true | mlBrier=0.18244176980067497 |
| M3 | true | deltaVsMarket=0.0046818505342073324 |
| M4 | true | bias=-0.019446726172758 |

| Metric | Value | Uncertainty |
|--------|------:|-------------|
| ML Brier | 0.18244176980067497 | SE≈0.009375092127823321 |
| Market Brier | 0.17775991926646764 | — |
| Δ vs market | 0.0046818505342073324 | SE≈0.004332451621776888 |
| bias | -0.019446726172758 | — |

### Coach C1–C6
| # | Pass | Class | Detail |
|---|:----:|-------|--------|
| C1 | true | passed | nMlWithClv=278 |
| C2 | true | passed | meanClv=0.0017845390265699645 |
| C3 | true | passed | pctBeatClose=0.45323741007194246 |
| C4 | true | passed | home=114 away=164 |
| C5 | true | passed | softGatesOk=true |
| C6 | true | passed | E2b_coachPickClv=PASS eligible |

Soft gates: **PASS_SOFT_GATES_ONLY** (n=403)  
CLV skips: {"no_qualify_edge":125} · harness withholds: {}

### Harness acceptance
`finalPass=false` — Unmet: mlAll=true clvAll=true e4=false  
mlAllPass=true · clvAllPass=true

## E4 injury

| Field | Value |
|-------|-------|
| Status | **OPEN_INSUFFICIENT_DATA** |
| Resolved | **false** |
| Requirements met | R4_behavioral_policy, R5_no_backfill |
| Requirements unmet | R1_pre_kick_snapshots, R2_join_labels, R3_segment_conservatism |

Blockers:
- No verified historical pre-kick injury archive for TUNING or FINAL_EVAL games
- SportsDataIO / ScoreTape timing not proven / not purchased (see ncaaf-e4-injury-provider.md)
- Forward snapshot count insufficient for slate-wide capture < kickoff joins
- Segment conservatism unscored on real joins (INSUFFICIENT_DATA)

See [`ncaaf-e4-status.md`](./ncaaf-e4-status.md) and [`ncaaf-e4-completion-path.md`](./ncaaf-e4-completion-path.md). Behavioral policy tests are done; historical predictive validation is not. M_base frozen; M_inj needs fresh prospective eval.

## E6

**Requested:** false  
**Allowed:** false  
E4 unresolved — E6 must not be requested

## Product holds

- `NCAAF_GAME_LINE_SIM_VALIDATED=false`
- No deploy / OTA / unlock
- Voice paused

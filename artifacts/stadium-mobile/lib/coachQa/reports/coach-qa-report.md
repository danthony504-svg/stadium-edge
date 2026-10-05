# AI COACH QA REPORT

Generated: 2026-10-05T17:53:43.228Z
Seed: 6092026

## Summary

| Metric | Count |
|---|---|
| Total tests | 13596 |
| Passed | 13566 |
| Failed | 30 |
| Warnings | 96 |

## By category

| Category | Passed | Failed | Warnings |
|---|---|---|---|
| data_quality | 5 | 0 | 1 |
| date_sport_team | 2 | 0 | 0 |
| failure_injection | 17 | 0 | 13 |
| fuzz_parser | 500 | 0 | 0 |
| fuzz_sequential | 4762 | 0 | 0 |
| mapping | 9 | 0 | 0 |
| market_coverage | 420 | 30 | 82 |
| parser | 6868 | 0 | 0 |
| performance | 66 | 0 | 0 |
| pipeline_counts | 8 | 0 | 0 |
| provider_integrity | 10 | 0 | 0 |
| recovery_alt | 3 | 0 | 0 |
| sequential | 872 | 0 | 0 |
| ticket_construction | 24 | 0 | 0 |

## Ranked findings

### 1. [P2] Live failure-injection not executed: cache miss

- **Category:** failure_injection
- **Prompt/sequence:** `"cache miss"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 2. [P2] Live failure-injection not executed: empty market

- **Category:** failure_injection
- **Prompt/sequence:** `"empty market"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 3. [P2] Live failure-injection not executed: malformed provider outcome

- **Category:** failure_injection
- **Prompt/sequence:** `"malformed provider outcome"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 4. [P2] Live failure-injection not executed: missing ESPN ID

- **Category:** failure_injection
- **Prompt/sequence:** `"missing ESPN ID"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 5. [P2] Live failure-injection not executed: missing history

- **Category:** failure_injection
- **Prompt/sequence:** `"missing history"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 6. [P2] Live failure-injection not executed: missing injury data

- **Category:** failure_injection
- **Prompt/sequence:** `"missing injury data"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 7. [P2] Live failure-injection not executed: missing weather

- **Category:** failure_injection
- **Prompt/sequence:** `"missing weather"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 8. [P2] Live failure-injection not executed: one sport failing while another works

- **Category:** failure_injection
- **Prompt/sequence:** `"one sport failing while another works"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 9. [P2] Live failure-injection not executed: partial board

- **Category:** failure_injection
- **Prompt/sequence:** `"partial board"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 10. [P2] Live failure-injection not executed: provider 429

- **Category:** failure_injection
- **Prompt/sequence:** `"provider 429"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 11. [P2] Live failure-injection not executed: provider timeout

- **Category:** failure_injection
- **Prompt/sequence:** `"provider timeout"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 12. [P2] Live failure-injection not executed: simulation timeout

- **Category:** failure_injection
- **Prompt/sequence:** `"simulation timeout"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 13. [P2] Live failure-injection not executed: stale cache

- **Category:** failure_injection
- **Prompt/sequence:** `"stale cache"`
- **Expected:** safe degrade without freeze/crash/fabricate
- **Actual:** SKIPPED in offline harness — needs controlled live/IO harness extension
- **Stage:** failure_injection
- **Likely file:** `lib/coach/buildParlay.ts / api-server odds routes`
- **Production affected:** no

### 14. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf pitcher strikeouts"`
- **Expected:** isMarketLocked with pitcher_strikeouts
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 15. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf hits+runs+RBIs"`
- **Expected:** isMarketLocked with batter_hits_runs_rbis
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 16. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf stolen bases"`
- **Expected:** isMarketLocked with batter_stolen_bases
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 17. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf total bases"`
- **Expected:** isMarketLocked with batter_total_bases
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 18. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf RBIs"`
- **Expected:** isMarketLocked with batter_rbis
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 19. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf hits"`
- **Expected:** isMarketLocked with batter_hits
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 20. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf runs"`
- **Expected:** isMarketLocked with batter_runs
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 21. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf passing attempts"`
- **Expected:** isMarketLocked with player_pass_attempts
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 22. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf rushing attempts"`
- **Expected:** isMarketLocked with player_rush_attempts
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 23. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf longest completion"`
- **Expected:** isMarketLocked with player_pass_longest_completion
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 24. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf longest rush"`
- **Expected:** isMarketLocked with player_rush_longest
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 25. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf completions"`
- **Expected:** isMarketLocked with player_pass_completions
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 26. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf pass interceptions"`
- **Expected:** isMarketLocked with player_pass_interceptions
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 27. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf goal scorer"`
- **Expected:** isMarketLocked with player_goal_scorer_anytime
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 28. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf shots on target"`
- **Expected:** isMarketLocked with player_shots_on_target
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 29. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf shots on goal"`
- **Expected:** isMarketLocked with player_shots_on_goal
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 30. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf shots"`
- **Expected:** isMarketLocked with player_shots
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 31. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf goals"`
- **Expected:** isMarketLocked with player_goals
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 32. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf pts+reb+ast"`
- **Expected:** isMarketLocked with player_points_rebounds_assists
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 33. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf pts+reb"`
- **Expected:** isMarketLocked with player_points_rebounds
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 34. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf pts+ast"`
- **Expected:** isMarketLocked with player_points_assists
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 35. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf reb+ast"`
- **Expected:** isMarketLocked with player_rebounds_assists
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 36. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf blocks+steals"`
- **Expected:** isMarketLocked with player_blocks_steals
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 37. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf rebounds"`
- **Expected:** isMarketLocked with player_rebounds
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 38. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf assists"`
- **Expected:** isMarketLocked with player_assists
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 39. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf threes"`
- **Expected:** isMarketLocked with player_threes
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 40. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf blocks"`
- **Expected:** isMarketLocked with player_blocks
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 41. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf steals"`
- **Expected:** isMarketLocked with player_steals
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 42. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf turnovers"`
- **Expected:** isMarketLocked with player_turnovers
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 43. [P2] Market family failed to lock for ncaaf

- **Category:** market_coverage
- **Prompt/sequence:** `"5 leg ncaaf points"`
- **Expected:** isMarketLocked with player_points
- **Actual:** locked=false keys=null
- **Stage:** parseCoachAskMarketConstraint
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 44. [P3] Suspicious prop flagged for review

- **Category:** data_quality
- **Prompt/sequence:** `"Ghost Runner"`
- **Expected:** sane line/odds on provider board
- **Actual:** line=999.5 odds=-110 id=prop-fabricated
- **Stage:** data-quality
- **Likely file:** `lib/coachQa/fixtures.ts (fixture) / board scan`
- **Production affected:** no


## Sequential / fuzz

- Sequential checks: 1872
- Stale-leak failures: 0
- Fuzz cases: 5262
- Fuzz failures: 0

## Sport × market × request-type matrix (sample)

| Sport | Market family | Request type | Status |
|---|---|---|---|
| mlb | mlb_strikeouts | explicit_lock | PASS |
| mlb | mlb_home_runs | explicit_lock | PASS |
| mlb | mlb_hits_runs_rbis | explicit_lock | PASS |
| mlb | mlb_stolen_bases | explicit_lock | PASS |
| mlb | mlb_total_bases | explicit_lock | PASS |
| mlb | mlb_rbis | explicit_lock | PASS |
| mlb | mlb_hits | explicit_lock | PASS |
| mlb | mlb_runs | explicit_lock | PASS |
| mlb | fb_pass_yds | explicit_lock | PASS |
| mlb | fb_rush_yds | explicit_lock | PASS |
| mlb | fb_rec_yds | explicit_lock | PASS |
| mlb | fb_pass_attempts | explicit_lock | PASS |
| mlb | fb_rush_attempts | explicit_lock | PASS |
| mlb | fb_longest_completion | explicit_lock | PASS |
| mlb | fb_longest_reception | explicit_lock | PASS |
| mlb | fb_longest_rush | explicit_lock | PASS |
| mlb | fb_completions | explicit_lock | PASS |
| mlb | fb_receptions | explicit_lock | PASS |
| mlb | fb_sacks | explicit_lock | PASS |
| mlb | fb_pass_ints | explicit_lock | PASS |
| mlb | fb_first_td | explicit_lock | PASS |
| mlb | fb_touchdowns | explicit_lock | PASS |
| mlb | fb_field_goals | explicit_lock | PASS |
| mlb | soccer_nhl_goal_scorer | explicit_lock | PASS |
| mlb | soccer_shots_on_target | explicit_lock | PASS |
| mlb | nhl_shots_on_goal | explicit_lock | PASS |
| mlb | soccer_shots | explicit_lock | PASS |
| mlb | nhl_soccer_goals | explicit_lock | PASS |
| mlb | nba_pra | explicit_lock | PASS |
| mlb | nba_pts_reb | explicit_lock | PASS |
| mlb | nba_pts_ast | explicit_lock | PASS |
| mlb | nba_reb_ast | explicit_lock | PASS |
| mlb | nba_combo_tab | explicit_lock | PASS |
| mlb | nba_blocks_steals | explicit_lock | PASS |
| mlb | nba_rebounds | explicit_lock | PASS |
| mlb | nba_assists | explicit_lock | PASS |
| mlb | nba_threes | explicit_lock | PASS |
| mlb | nba_blocks | explicit_lock | PASS |
| mlb | nba_steals | explicit_lock | PASS |
| mlb | nba_turnovers | explicit_lock | PASS |
| mlb | nba_points | explicit_lock | PASS |
| mlb | moneylines | game_line | PASS |
| mlb | spreads | game_line | PASS |
| mlb | totals | game_line | PASS |
| mlb | game lines only | game_line | PASS |
| wnba | mlb_strikeouts | explicit_lock | PASS |
| wnba | mlb_home_runs | explicit_lock | PASS |
| wnba | mlb_hits_runs_rbis | explicit_lock | PASS |
| wnba | mlb_stolen_bases | explicit_lock | PASS |
| wnba | mlb_total_bases | explicit_lock | PASS |
| wnba | mlb_rbis | explicit_lock | PASS |
| wnba | mlb_hits | explicit_lock | PASS |
| wnba | mlb_runs | explicit_lock | PASS |
| wnba | fb_pass_yds | explicit_lock | PASS |
| wnba | fb_rush_yds | explicit_lock | PASS |
| wnba | fb_rec_yds | explicit_lock | PASS |
| wnba | fb_pass_attempts | explicit_lock | PASS |
| wnba | fb_rush_attempts | explicit_lock | PASS |
| wnba | fb_longest_completion | explicit_lock | PASS |
| wnba | fb_longest_reception | explicit_lock | PASS |
| … | 390 more rows in JSON | … | … |

## Notes

- Offline harness: parser/state/fuzz/fixture-pipeline only. Large fuzz does not call paid/live APIs.
- Live provider end-to-end validation is a separate controlled subset (not executed in this default run).
- Documented intentional inheritance: propsOnly only onto explicit slate-day refinements (`N … for tomorrow/tonight/today`). Bare `5 leg` after soccer/player-props must NOT inherit (RC1 fix).
- Screenshot sequence stale propsOnly confirmed=false
- Matrix size=3125; sequential seeds=10
- No production Coach thresholds, selection, merge, deploy, OTA, or EAS build were changed.

# AI COACH QA REPORT

Generated: 2026-10-06T01:38:12.384Z
Seed: 6092026

## Summary

| Metric | Count |
|---|---|
| Total tests | 15007 |
| Passed | 15007 |
| Failed | 0 |
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
| market_coverage | 450 | 0 | 82 |
| parser | 8268 | 0 | 0 |
| performance | 66 | 0 | 0 |
| pipeline_counts | 8 | 0 | 0 |
| provider_integrity | 10 | 0 | 0 |
| recovery_alt | 3 | 0 | 0 |
| sequential | 880 | 0 | 0 |
| terminal_state | 3 | 0 | 0 |
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

### 14. [P3] Suspicious prop flagged for review

- **Category:** data_quality
- **Prompt/sequence:** `"Ghost Runner"`
- **Expected:** sane line/odds on provider board
- **Actual:** line=999.5 odds=-110 id=prop-fabricated
- **Stage:** data-quality
- **Likely file:** `lib/coachQa/fixtures.ts (fixture) / board scan`
- **Production affected:** no


## Sequential / fuzz

- Sequential checks: 1880
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

- Offline harness: parser/state/fuzz/fixture-pipeline + terminal-state guards. Large fuzz does not call paid/live APIs.
- Live A/B terminal audit (fresh 5 leg vs soccer→5 leg) runs from coachQa.harness.test.ts — parser suites alone cannot pass while the async pipeline hangs.
- Documented intentional inheritance: propsOnly only onto explicit slate-day refinements (`N … for tomorrow/tonight/today`). Bare `5 leg` after soccer/player-props must NOT inherit (RC1 fix).
- Screenshot sequence stale propsOnly confirmed=false
- Matrix size=3125; sequential seeds=13
- No production Coach thresholds, selection, merge, deploy, OTA, or EAS build were changed.

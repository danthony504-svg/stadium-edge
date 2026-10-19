# Coach prop catalog and selection audit — October 19, 2026

This inventory comes from the repository provider allowlists, not a promise that every book posts every market every day. It covers all currently requested player-prop families. A listed market still needs genuine posted odds, a matched athlete/event, adequate history, supported exact-market simulation, positive EV/edge, at least 52% confidence and C+ grade, and ticket correlation checks. No thresholds were lowered.

**55 distinct full-game families across 8 prop sports; 95 sport/market combinations.** Alternate lines and period variants are listed separately. UFC and tennis currently have game markets, not player-prop provider catalogs in this pipeline.

## Why the issue repeated

1. **Premature ladder collapse:** choosing the highest-EV line before final confidence/grade qualification discarded lower-EV qualifying alternatives. Fix: score all covered posted rungs, then let qualification and ladder dedupe choose the ticket.
2. **Repeated simulation seeds:** the candidate cap was spent on repeated thresholds/sides of one athlete/stat. Fix: choose distinct event/athlete/stat distributions within the existing cap.
3. **Unused shared-draw results:** the server already returned other posted thresholds and both sides, but the client could bind trusted identity only to the seed lines. Fix: bind covered posted lines to their own exact athlete/event/market/side/threshold; ambiguous legacy keys, different events/stats/periods, and unposted thresholds remain blocked.
4. **Missing server mappings:** RBI, runs, pitcher outs, double-double, field goals, pass+rush yards, rush+receiving yards, and pass+rush+receiving yards had client/provider support but no matching server stat extraction. Fixed using real source fields and exact sums/conversions, with missing inputs remaining null.
5. **Binary No sides:** a posted No/Under price with a null provider point was dropped. Known Yes/No markets now retain that price and use the settlement threshold 0.5; numeric markets do not receive an invented threshold.
6. **Unclear failure copy:** available but ungradable lines could be described as unavailable. Copy now distinguishes posted-but-ungradable evidence from genuine quality rejection and preserves graded counts across recovery.

7. **Loose pool-row lookup:** same-player/side fallbacks could borrow another stat or rematch. Exact row matching now binds the stat, side, threshold, game and known identity; ambiguous matches fail closed.

## What remains conditional or deliberately blocked

- First-touchdown and first-goalscorer markets require scoring order. Per-game TD/goal totals cannot establish who scored first; these remain blocked with missing-scoring-order diagnostics.
- Missing athlete/event identity, incomplete stats, insufficient samples, provider unavailability and untrusted simulation evidence remain real blockers.
- Simulation endpoint throttling is not evidence that a pick failed quality. The wider audit encountered four HTTP 429 responses; no complete “all remaining picks failed” claim is justified.
- Early-period markets require period-specific data and simulation. Listing a Q1/H1 feed key does not make full-game statistics valid for that period or override request exclusions.
- Stat parity is not model calibration or a guarantee of winning. Each market still passes the existing model/provenance/quality gates.

## Replay evidence before this fix

- Captured NFL matchup: Washington at San Francisco, October 19 local time. Prices/history can change after capture; this is not an exact reconstruction of the phone run.
- Rushing/receiving: 453 posted sides, initial 60 candidates, 42 graded. An audit found qualifying alternatives omitted by selection/sample coverage; a throttled broader pass could not establish a complete total. These are sides/rungs, not 453 independent bets.
- Touchdowns: 58 matching sides, 40 selected, 23 graded, 12 odds-clearing scored candidates, zero staged in the replay. The 17 ungraded candidates included 7 without scoring order, 4 with insufficient samples, 2 with stat mapping failures and 4 otherwise ungraded. The 12 staged-stage rejects were confidence-floor failures.

## Replay after the selection fix

Using the same captured matchup board and live history/simulation responses, the updated builder selected 47 distinct seeds, evaluated 403 covered posted sides, graded 360, and returned 10/10 in about 5.9 seconds. The audit saw 35 passing sides across 13 player/stat ladders; these are not 35 independent parlay legs. This is a replay measurement, not a guarantee for a different device/network or later prices. No 429 responses occurred in that replay.

## Full-game prop list

“Mapped” means client/server stat extraction parity is verified by the catalog regression test. Availability and simulation qualification remain conditional. “Alt” means an alternate provider key is requested, not necessarily posted tonight.

### NBA — 13 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Points | `player_points` | Yes | Mapped; evidence required |
| Rebounds | `player_rebounds` | Yes | Mapped; evidence required |
| Assists | `player_assists` | Yes | Mapped; evidence required |
| 3-Pointers | `player_threes` | Yes | Mapped; evidence required |
| Pts+Reb+Ast | `player_points_rebounds_assists` | No | Mapped; evidence required |
| Pts+Reb | `player_points_rebounds` | No | Mapped; evidence required |
| Pts+Ast | `player_points_assists` | No | Mapped; evidence required |
| Reb+Ast | `player_rebounds_assists` | No | Mapped; evidence required |
| Blocks | `player_blocks` | No | Mapped; evidence required |
| Steals | `player_steals` | No | Mapped; evidence required |
| Blocks+Steals | `player_blocks_steals` | No | Mapped; evidence required |
| Turnovers | `player_turnovers` | No | Mapped; evidence required |
| Double-Double | `player_double_double` | No | Mapped; evidence required |

### WNBA — 13 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Points | `player_points` | Yes | Mapped; evidence required |
| Rebounds | `player_rebounds` | Yes | Mapped; evidence required |
| Assists | `player_assists` | Yes | Mapped; evidence required |
| 3-Pointers | `player_threes` | Yes | Mapped; evidence required |
| Pts+Reb+Ast | `player_points_rebounds_assists` | No | Mapped; evidence required |
| Pts+Reb | `player_points_rebounds` | No | Mapped; evidence required |
| Pts+Ast | `player_points_assists` | No | Mapped; evidence required |
| Reb+Ast | `player_rebounds_assists` | No | Mapped; evidence required |
| Blocks | `player_blocks` | No | Mapped; evidence required |
| Steals | `player_steals` | No | Mapped; evidence required |
| Blocks+Steals | `player_blocks_steals` | No | Mapped; evidence required |
| Turnovers | `player_turnovers` | No | Mapped; evidence required |
| Double-Double | `player_double_double` | No | Mapped; evidence required |

### NCAAB — 4 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Points | `player_points` | Yes | Mapped; evidence required |
| Rebounds | `player_rebounds` | Yes | Mapped; evidence required |
| Assists | `player_assists` | Yes | Mapped; evidence required |
| Double-Double | `player_double_double` | No | Mapped; evidence required |

### NFL — 27 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Pass Yds | `player_pass_yds` | Yes | Mapped; evidence required |
| Pass Attempts | `player_pass_attempts` | Yes | Mapped; evidence required |
| Completions | `player_pass_completions` | Yes | Mapped; evidence required |
| Pass TDs | `player_pass_tds` | Yes | Mapped; evidence required |
| Pass INTs | `player_pass_interceptions` | Yes | Mapped; evidence required |
| Longest Completion | `player_pass_longest_completion` | Yes | Mapped; evidence required |
| Rush Yds | `player_rush_yds` | Yes | Mapped; evidence required |
| Rush Attempts | `player_rush_attempts` | Yes | Mapped; evidence required |
| Longest Rush | `player_rush_longest` | Yes | Mapped; evidence required |
| Rec Yds | `player_reception_yds` | Yes | Mapped; evidence required |
| Receptions | `player_receptions` | Yes | Mapped; evidence required |
| Longest Reception | `player_reception_longest` | Yes | Mapped; evidence required |
| Anytime TD | `player_anytime_td` | No | Mapped; evidence required |
| Sacks | `player_sacks` | No | Mapped; evidence required |
| First TD | `player_first_td` | No | Scoring order required — blocked |
| Field Goals | `player_field_goals` | Yes | Mapped; evidence required |
| Pass+Rush Yds | `player_pass_rush_yds` | Yes | Mapped; evidence required |
| Rush+Rec Yds | `player_rush_reception_yds` | Yes | Mapped; evidence required |
| Rush+Rec TDs | `player_rush_reception_tds` | Yes | Mapped; evidence required |
| Pass+Rush+Rec Yds | `player_pass_rush_reception_yds` | Yes | Mapped; evidence required |
| Pass+Rush+Rec TDs | `player_pass_rush_reception_tds` | Yes | Mapped; evidence required |
| Rush TDs | `player_rush_tds` | Yes | Mapped; evidence required |
| Rec TDs | `player_reception_tds` | Yes | Mapped; evidence required |
| Kicking Points | `player_kicking_points` | No | Mapped; evidence required |
| Tackles + Assists | `player_tackles_assists` | No | Mapped; evidence required |
| Solo Tackles | `player_solo_tackles` | No | Mapped; evidence required |
| Defensive INTs | `player_defensive_interceptions` | No | Mapped; evidence required |

### NCAAF — 21 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Pass Yds | `player_pass_yds` | Yes | Mapped; evidence required |
| Pass Attempts | `player_pass_attempts` | Yes | Mapped; evidence required |
| Completions | `player_pass_completions` | Yes | Mapped; evidence required |
| Pass TDs | `player_pass_tds` | Yes | Mapped; evidence required |
| Pass INTs | `player_pass_interceptions` | Yes | Mapped; evidence required |
| Longest Completion | `player_pass_longest_completion` | Yes | Mapped; evidence required |
| Rush Yds | `player_rush_yds` | Yes | Mapped; evidence required |
| Rush Attempts | `player_rush_attempts` | Yes | Mapped; evidence required |
| Longest Rush | `player_rush_longest` | Yes | Mapped; evidence required |
| Rec Yds | `player_reception_yds` | Yes | Mapped; evidence required |
| Receptions | `player_receptions` | Yes | Mapped; evidence required |
| Longest Reception | `player_reception_longest` | Yes | Mapped; evidence required |
| Anytime TD | `player_anytime_td` | No | Mapped; evidence required |
| First TD | `player_first_td` | No | Scoring order required — blocked |
| Field Goals | `player_field_goals` | No | Mapped; evidence required |
| Pass+Rush Yds | `player_pass_rush_yds` | No | Mapped; evidence required |
| Rush+Rec Yds | `player_rush_reception_yds` | No | Mapped; evidence required |
| Rush+Rec TDs | `player_rush_reception_tds` | No | Mapped; evidence required |
| Pass+Rush+Rec Yds | `player_pass_rush_reception_yds` | No | Mapped; evidence required |
| Rush TDs | `player_rush_tds` | No | Mapped; evidence required |
| Rec TDs | `player_reception_tds` | No | Mapped; evidence required |

### MLB — 9 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Hits | `batter_hits` | Yes | Mapped; evidence required |
| Total Bases | `batter_total_bases` | Yes | Mapped; evidence required |
| Home Runs | `batter_home_runs` | Yes | Mapped; evidence required |
| Strikeouts | `pitcher_strikeouts` | Yes | Mapped; evidence required |
| Stolen Bases | `batter_stolen_bases` | No | Mapped; evidence required |
| Hits+Runs+RBIs | `batter_hits_runs_rbis` | Yes | Mapped; evidence required |
| RBIs | `batter_rbis` | Yes | Mapped; evidence required |
| Runs | `batter_runs` | Yes | Mapped; evidence required |
| Pitcher Outs | `pitcher_outs` | Yes | Mapped; evidence required |

### NHL — 4 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Points | `player_points` | Yes | Mapped; evidence required |
| Goals | `player_goals` | No | Mapped; evidence required |
| Assists | `player_assists` | Yes | Mapped; evidence required |
| Shots on Goal | `player_shots_on_goal` | Yes | Mapped; evidence required |

### SOCCER — 4 families

| Prop | Canonical market key | Alt requested | Stat status |
|---|---|---|---|
| Anytime Goal | `player_goal_scorer_anytime` | No | Mapped; evidence required |
| First Goal | `player_first_goal_scorer` | No | Scoring order required — blocked |
| Shots on Target | `player_shots_on_target` | No | Mapped; evidence required |
| Shots | `player_shots` | No | Mapped; evidence required |

## Period keys requested by the feed

- **NBA:** `player_points_q1`, `player_rebounds_q1`, `player_assists_q1`
- **WNBA:** `player_points_q1`
- **NFL:** `player_pass_yds_q1`, `player_pass_tds_q1`, `player_rush_yds_q1`, `player_reception_yds_q1`, `player_pass_yds_h1`, `player_rush_yds_h1`, `player_reception_yds_h1`
- **NCAAF:** `player_pass_yds_q1`, `player_rush_yds_q1`, `player_reception_yds_q1`, `player_pass_yds_h1`, `player_rush_yds_h1`, `player_reception_yds_h1`

## Validation

- Release-critical suite: **483 passing tests**. iOS Expo export and API bundle build pass. Full TypeScript checking still has the same 290 pre-existing errors as unchanged main; no new diagnostics. Four older recovery tests expecting unapproved historical fallback also fail on unchanged main and are not claimed fixed by this work.
- Catalog regression checks every advertised full-game canonical market and alternate suffix against client/server stat semantics; first-scorer markets must reject aggregate counts.
- Pipeline regression verifies broader player coverage under the same seed cap, shared-draw provenance for posted alternates, qualification before ladder seating, no cross-event/athlete/sport/stat/period reuse, and no grading of unposted thresholds.
- Binary tests verify preservation of genuine No prices and prohibit defaults for missing numeric lines.
- Existing 52%/C+, exact-market 10k provenance, rare-count restrictions and market/sport locks remain required.

Production OTA has not been published as part of this audit. Backend mapping changes require an API deployment; mobile selection changes require a preview OTA first.

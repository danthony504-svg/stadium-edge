# TUNING pipeline audit (cache-only)

**Research-only** · stamp `ncaaf-team-strength-v0-research` · FINAL_EVAL untouched · gate false · no paid Odds · closes eval-only

**Verdict:** `SCORING_PIPELINE_SOUND_WITH_FCS_CLASSIFICATION_DEFECT`

## 1. Confirmed defects

- FCS name-heuristic incomplete: 38 audit-extra FCS-like ids not flagged by model regex (pollutes opp-adj when unflagged)
- Unflagged teams with no 2024 seed (defaults to off/def=24): Bryant Bulldogs

## 2. Missing inputs (not scored as defects)

- Neutral-site / conference / ESPN groupId fields absent on TUNING (+ prior) game rows

## 3. Model weaknesses (pipeline can be sound and model still fail)

- 40 2025 teams lack 2024 FBS-seeded ratings → default off/def=24. Of these, 39 are FCS-flagged (skipped in seed by design) and 1 are unflagged. Defaults compress FBS–FCS mismatches (e.g. weak FBS vs default-24 FCS can flip μ sign).
- Large-14+ TS margin bias=-13.3 (homeFav n=158 bias=-16.0; awayFav n=27 bias=2.2); drive bias=-9.5

## 4. Independent score recompute

Fair cohort n=421 (skippedThin=3).

| Model | n | ML Brier | Δ mkt | ATS n | ATS Brier | bias | dirFlips |
|-------|--:|---------:|------:|------:|----------:|-----:|---------:|
| `locked_drive_teamMean` | 421 | 0.2021 | 0.0520 | 413 | 0.2936 | -2.2 | 0 |
| `ts_full` | 421 | 0.1926 | 0.0425 | 413 | 0.2787 | -6.7 | 0 |

Matches published v0 drive scorecard: **true**. TS full match (tol 0.002): **true**.

## 5. Check list

| Check | Status | Detail |
|-------|:------:|--------|
| `final_eval_untouched` | PASS | archive.finalEval="UNTOUCHED"; FINAL_EVAL fixtures not loaded by this audit; split=TUNING |
| `fixture_kickoff_pre_sorted` | WARN | Raw TUNING fixture is not kickoff-sorted (walker re-sorts — OK if walk sorts) |
| `neutral_site_fields` | MISSING | No neutral/conference/groupId on fixtures — cannot verify neutral HFA handling |
| `fcs_classifier_coverage` | FAIL | modelFlags=43 auditExtra=75 gap=38 e.g. Elon Phoenix; Rhode Island Rams; Arkansas-Pine Bluff Golden Lions; North Carolina A&T Aggies; Western Carolina Catamounts; Robert Morris Colonials; East Tennessee State Buccaneers; Portland State Vikings |
| `team_name_join` | PASS | nameMismatch=0 |
| `score_join` | PASS | scoreMismatch=0 |
| `spread_home_away_negation` | PASS | inconsistent home+away spreads: 0 |
| `spread_ml_sign_agreement` | WARN | pick-em-ish discord count=5 (near-even lines can disagree) |
| `kickoff_close_vs_espn` | PASS | >/6h/ mismatches=0 |
| `pushes_and_ties` | PASS | atsPushes=8 mlTies=0 (ties excluded from fair cohort; pushes excluded from ATS Brier) |
| `prior_coverage` | FAIL | 2025 teams=225 seeded=185 missingPrior=40 (FCS-flagged-by-design=39; unflagged=1: Bryant Bulldogs) |
| `kickoff_walk_order` | PASS | 2025 walk n=471 matches kickoff+eventId sort |
| `ats_label_vs_strict_cover` | PASS | mismatches=0 (label uses push-null; sim uses strict >) |
| `market_implied_direction` | PASS | heavyML direction flips=0 |
| `independent_recompute_vs_v0_drive` | PASS | indep ml=0.2021 ats=0.2936 n=421 vs pub ml=0.2021 ats=0.2936 n=421 |
| `independent_recompute_vs_v0_ts_full` | PASS | indep ml=0.1926 ats=0.2787 n=421 vs pub ml=0.1926 ats=0.2787 n=421 (MC noise may differ if RNG path changed) |

## 6. Large favorites (14+) error inspection

n=185 (homeFav=158, awayFav=27). TS bias=-13.3; drive bias=-9.5.

|Abs spread| 23.5 · |act| 26.3 · |pred TS| 11.3 · |pred drive| 12.4

Unseeded-in-slice=40 · FCS-flagged-in-slice=38 · **unflagged FCS-like in slice=31**

### Worst TS under-predictions (pred − act)

| event | week | matchup | spread | act | pred | err | seeded | fcsFlag |
|-------|-----:|---------|-------:|----:|-----:|----:|:------:|:-------:|
| 401762462 | 2 | Temple Owls vs Howard Bison | -28.5 | 48 | -5.9 | -53.9 | false | true |
| 401752815 | 2 | Ohio State Buckeyes vs Grambling Tigers | -54.5 | 70 | 16.7 | -53.3 | false | true |
| 401762819 | 3 | Toledo Rockets vs Morgan State Bears | -33.5 | 60 | 6.7 | -53.3 | true | false |
| 401762435 | 1 | North Texas Mean Green vs Lamar Cardinals | -27.5 | 51 | -1.3 | -52.3 | true | false |
| 401752824 | 2 | Oregon Ducks vs Oklahoma State Cowboys | -28.5 | 66 | 16.9 | -49.1 | true | false |
| 401754520 | 1 | Pittsburgh Panthers vs Duquesne Dukes | -40.5 | 52 | 4.4 | -47.6 | false | true |
| 401752821 | 2 | Washington Huskies vs UC Davis Aggies | -29.5 | 60 | 12.4 | -47.6 | true | false |
| 401752674 | 1 | Missouri Tigers vs Central Arkansas Bears | -38.5 | 55 | 8.1 | -46.9 | false | true |
| 401762822 | 4 | Central Michigan Chippewas vs Wagner Seahawks | -29.5 | 39 | -7.8 | -46.8 | false | true |
| 401752668 | 1 | Florida Gators vs Long Island University Sharks | -46.5 | 55 | 9.3 | -45.7 | false | true |
| 401752833 | 3 | Rutgers Scarlet Knights vs Norfolk State Spartans | -44.5 | 50 | 5.2 | -44.8 | false | true |
| 401756879 | 2 | Arizona Wildcats vs Weber State Wildcats | -32.5 | 45 | 0.2 | -44.8 | false | true |

## 7. Prior coverage / defaults

Seeded teams=191 · off mean/sd=23.0/10.23 · range [-13.1, 44.8] · sample max|μ|=51.4 · HFA=2.5

2025 teams missing 2024 seed (40): Idaho State Bengals; Delaware Blue Hens; Delaware State Hornets; Saint Francis Red Flash; Central Arkansas Bears; UT Martin Skyhawks; Stephen F. Austin Lumberjacks; Alabama State Hornets; Tarleton State Texans; Wagner Seahawks; Bethune-Cookman Wildcats; Montana State Bobcats; Long Island University Sharks; North Dakota Fighting Hawks; South Dakota Coyotes; Duquesne Dukes; Eastern Kentucky Colonels; Chattanooga Mocs; Weber State Wildcats; Nicholls Colonels; SE Louisiana Lions; Abilene Christian Wildcats; Bryant Bulldogs; Eastern Washington Eagles; Grambling Tigers; Howard Bison; Northern Iowa Panthers; Jackson State Tigers; McNeese Cowboys; Villanova Wildcats; Houston Christian Huskies; Towson Tigers; Samford Bulldogs; Norfolk State Spartans; Youngstown State Penguins; Richmond Spiders; Incarnate Word Cardinals; Prairie View A&M Panthers; Southern Jaguars; Wofford Terriers

## 8. Minimum additional data before further modeling

Scoring joins, ML/ATS labels, push handling, probability direction, and kickoff walk order are **sound** (independent recompute matches published v0). **Do not build another model until FBS/FCS classification is fixed on cached rows** (retag + re-seed is enough — no paid pull, no FINAL_EVAL).

- **ESPN FBS/FCS (or group/conference) team classification IDs on cached rows** — Confirmed defect: name regex misses dozens of FCS opponents → opp-adj pollution, wrong skip set, and default-24 compression on big favorites _(acquisition: Free ESPN team/group fields or a static FBS ID list — no Odds spend; retag existing fixtures; blocksModeling=true)_
- **Cache-only retag of 2023–2025 games with that classification, then re-seed** — No new game retrieval required; re-run v0 compare on identical closes cohort _(acquisition: Cache-only; blocksModeling=true)_
- **Neutral-site flag on game rows (optional next)** — Missing input — cannot verify HFA on neutrals; not implicated in the −14 large-fav bias _(acquisition: Free ESPN venue fields if present; blocksModeling=false)_

## Repro
```bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningPipelineAudit.ts
```
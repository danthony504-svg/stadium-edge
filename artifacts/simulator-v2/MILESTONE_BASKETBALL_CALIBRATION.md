# Milestone — Basketball calibration (E.2+)

## Root cause (prior NBA ECE ≈ 0.065 / NCAAB ≈ 0.089)
1. **Form overconfidence** — raw recent ptsFor/Against treated as true means.
2. **Underdispersed margins** — Poisson quarters without game-level intensity shock; between-game sim-mean var ≪ actual.
3. **Fixed grid spreads** (−3.5 / −7.5) are not game-specific lines → large spread bias when evaluated as if they were closers.
4. Heavy shrink (0.4) **collapsed** strength separation and worsened ECE — abandoned after val diagnostic.

## Corrections (`basketball.joint.v0` @ **0.3.0**)
| Lever | After |
|-------|--------|
| Form shrink | 20% toward league mean |
| Per-draw shock | lognormal σ≈0.12 (NBA/WNBA), 0.14 (NCAAB) |
| HFA | NBA 2.0 / WNBA 1.8 / NCAAB 2.6 (was 2.4 / 3.2) |

## Holdout gates (final; never tuned on)
| Family | Verdict | n | ECE |
|--------|---------|---|-----|
| nba:total | **PASS** | 640 | 0.0318 |
| nba:team_total | INSUFFICIENT (n) | 320 | 0.0329 |
| nba:ml | INSUFFICIENT | 320 | 0.1038 |
| nba:spread | **FAIL** | 640 | 0.2598 |
| nba:main_all | **FAIL** | 1280 | 0.0613 |
| wnba:* | mostly INSUFFICIENT / FAIL | ≤708 | ECE 0.035–0.24 |
| ncaab:main_all | **FAIL** | 1584 | 0.0752 |
| *:closing_line | **INSUFFICIENT_DATA** | 0 | unlicensed |
| *:player_prop_named | **INSUFFICIENT_DATA** | 0 | not wired |

WNBA expanded (2022–2024 dense dates, n_games=709); prior ECE 0.035 **did not hold** on larger main_all (ECE 0.068).

## Isolation
Shadow-only. Serve off. Allowlists empty. No Coach / P0 / PR#649 / OTA.

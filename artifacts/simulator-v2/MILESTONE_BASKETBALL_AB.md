# Milestone — Basketball A/B holdout (v0.2 vs v0.3)

Independent OOS on identical chronological holdout games per league.
Shadow-only. Gates unchanged (minOos=500, maxEce=0.04).

## Profiles
| Profile | Shrink | Shock σ | HFA NBA/WNBA/NCAAB |
|---------|--------|---------|---------------------|
| v0.2 | 0 | 0 | 2.4 / 2.4 / 3.2 |
| v0.3 | 0.2 | 0.12 / 0.14 | 2.0 / 1.8 / 2.6 |

## Artifacts
- `eval/runBasketballAbHoldout.ts` → `eval:basketball-ab`
- `eval/report/BASKETBALL_AB_HOLDOUT.md`
- `eval/report/BASKETBALL_AB_GATES.md`

## Isolation
Serve off; allowlists empty; no Coach / P0 / PR#649 / OTA.

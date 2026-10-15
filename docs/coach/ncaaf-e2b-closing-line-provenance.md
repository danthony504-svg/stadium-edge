# NCAAF closing-line archive — provenance

The file `artifacts/api-server/test/fixtures/ncaaf-phase-e-closing-lines.json` was saved on branch `cursor/odds-api-access-5cb3` (PR 737), not on this branch's earlier commits. Saying the file was absent from `cursor/nfl-spread-ml-scoring-hang-b9b4` did not erase that save.

## Where it was written

| Item | Value |
|---|---|
| Commit | `7fbf065a607899c49d2e5aa1d636160b74ca0eb4` |
| Date | 2026-10-14 22:25 UTC |
| Message | `feat(coach): E2b pre-kickoff closing lines + CLV; document E4 provider` |
| PR | https://github.com/danthony504-svg/stadium-edge/pull/737 |
| Branch tip that still contains it | `12e355af16fd5df6c3edbd659484fd2afe3b19b3` |
| Builder | `artifacts/api-server/scripts/ncaafPhaseE2bClosingLines.py` on that branch |
| Archive `generatedAt` | `2026-10-14T22:22:07.230749+00:00` |
| Close definition | Last Odds API historical snapshot with `date=kickoff` (closest snapshot at or before commence). Midday slate dumps are not closes. |
| Rows | 842 matched, 774 with finite home spread and moneyline, 29 still missing |
| Id field | `gameId` (ESPN event id). This branch's loader accepts `gameId` or `eventId`. |

## What “E2b passed” referred to

Report `ncaaf-phase-e-e2b-report.json` on that branch, `generatedAt` `2026-10-14T23:39:39.491Z`:

| Verdict key | Value |
|---|---|
| `E2b_closingArchive` | **PASS** |
| `E2b_closeArchiveSoftGates` | **PASS_SOFT_GATES_ONLY** |
| `E2b_coachPickClv` | **COMPUTED_NO_PASS_LABEL** |
| `NCAAF_GAME_LINE_SIM_VALIDATED` | false |

The calibration report on the same branch (`generatedAt` `2026-10-14T23:39:48.985Z`) set `E2_closeArchiveSoftGates` to PASS at **1,500** sims on `nfl-drive` **before** `ppg-per-drive-v1`. That engine passed points per game in as points per drive and then applied the NCAAF ×0.48 scale. The soft-gate numbers recorded there were about n=713, market Brier 0.179, engine Brier 0.219, mean(engine − market) +0.019.

Coach pick CLV on that same archive, 10,000 sims, was computed and left without a PASS label: 182 selections, mean ML CLV **−0.0234**, 20.9% of ML picks beat the close, hit rate 0.497. PR 737 says the soft gates are not CLV.

An earlier report on this branch's history (`2026-10-14T21:24:31.034Z`) had E2b `INSUFFICIENT_DATA` because that run did not have the file. Both statements were true of different commits. The PASS claim is the PR 737 soft-gate claim. It is not a PASS of `ppg-per-drive-v1`, and copying the file here does not restore it (`restored: false`).

## This branch

The JSON and CSV are vendored from `7fbf065a`. The corrected engine is remeasured against the joined rows. Soft gates use the thresholds already published on PR 737 (n ≥ 200, both Briers under 0.25, absolute mean probability gap ≤ 0.15). Coach pick CLV stays without a PASS label. `NCAAF_GAME_LINE_SIM_VALIDATED` stays false.

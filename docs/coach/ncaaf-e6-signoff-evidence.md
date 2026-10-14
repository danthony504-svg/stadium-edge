# E6 — Exact evidence pack for human sign-off (draft)

**Flag:** `NCAAF_GAME_LINE_SIM_VALIDATED` remains **`false`**. Do not flip until every item below is checked and recorded in the flag-flip PR.

## Required attachments / citations

| # | Evidence | Location / status |
|---|----------|-------------------|
| 1 | E2a outcome calibration PASS (1500+ sims) | `test/fixtures/ncaaf-phase-e-calibration-report.json` — Brier &lt; coin, ECE≤0.12, \|bias\|≤0.08, dog cover≤0.70 |
| 2 | Close archive (pre-kickoff Odds snaps) + soft gates | Same report `E2_closeArchiveSoftGates`; archive `ncaaf-phase-e-closing-lines.json` |
| 3 | **Coach pick CLV** at selection-time prices (10k sims) | `ncaaf-phase-e-coach-pick-clv-report.json` — **182 picks** (107H/75A), mean ML CLV **−0.023**, hit **0.497**, Wilson **0.425–0.570**; verdict **`COMPUTED_NO_PASS_LABEL`** |
| 4 | Untouched-period market baseline | Same report: n=391 after 2024-10-15, market Brier close-ML **0.189** (no Coach picks) |
| 5 | Competition scope | Odds-listed FBS only; residual App State / Southern Miss / FCS misses documented in checklist |
| 6 | Leakage proof | `test/ncaafPhaseEHoldoutLeakage.test.ts` green |
| 7 | E4 injury conservatism | **OPEN** — need pre-kickoff-timestamped injuryKnown join; see `ncaaf-e4-injury-provider.md` + snapshot manifest |
| 8 | E5 regression suite | `coachP0UnvalidatedTotals` + multi-sport P0 tests green on flag-flip commit |
| 9 | E2E device/build | Valid simulated NCAAF spread/ML picks (not empty early-exit only) after flag flip |
| 10 | Human sign-off line | Approver name, date (UTC), commit SHA of the **flag-only** PR |

## Sign-off template (paste into flag-flip PR)

```
E6 sign-off
Approver: <name>
Date (UTC): <YYYY-MM-DD>
Commit: <sha>
E2a: PASS (report sha/path)
Coach pick CLV reviewed: <n picks, mean CLV, hit rate, Wilson> — accept / reject
E4: PASS with injuryKnown null≠false — <source + n known/unknown>
E5: green
E2E: <device/build note>
Competition scope: Odds-listed FBS
NCAAF_GAME_LINE_SIM_VALIDATED: true (this PR only)
```

## Explicit non-evidence

- Soft-gate `mean(engineP − marketP_close)` is **not** CLV and must not be cited as CLV PASS.
- Blanket home-team CLV studies are **not** Coach performance.
- SportsDataIO / ScoreTape subscriptions are **not** approved from this pack without documented pre-kickoff timestamps.

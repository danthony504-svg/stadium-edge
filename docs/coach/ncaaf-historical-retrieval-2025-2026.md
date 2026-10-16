# Exact historical retrieval — 2025 TUNING + FINAL_EVAL / completed 2026

**Status:** Spec only — **no paid Odds calls this turn** (`ODDS_API_KEY` unset).  
**Free work done:** ESPN TUNING games (2025 weeks 1–7) vendored. FINAL_EVAL games **not** written to fixtures (untouched).

## Credential

| Item | Requirement |
|------|-------------|
| Secret name | `ODDS_API_KEY` (same as api-server / Render) |
| Agent status | **Missing** — inject as Cursor/Render secret; never paste into chat |
| Plan | Odds API plan that allows **historical** `/v4/historical/odds` (10× live credit rate) |

## Sport / markets / regions

| Field | Value |
|-------|--------|
| Sport key | `americanfootball_ncaaf` |
| Closing markets (ML + spreads restore path) | `h2h,spreads` |
| Optional totals (still blocked without archive) | add `totals` |
| Optional ALTs | `alternate_spreads` via **per-event** historical-event odds (expensive) |
| Regions | `us` (1) for eval backfill |

**Closing definition (unchanged):** one historical request per kickoff **minute bucket** with `date=<kickoffIso>`; API returns last snapshot ≤ commence. Script: `ncaafPhaseE2bClosingLines.py` (`NCAAF_E2B_MARKETS`).

## Credit math (historical featured)

`creditsPerBucket = 10 × markets × regions`

| Pull | Games (ESPN count) | Minute buckets (est.) | Markets | Credits |
|------|--------------------|------------------------|---------|---------|
| **TUNING** 2025 w1–7 | **471** (vendored) | **177** (exact) | h2h,spreads | **177 × 20 = 3 540** |
| TUNING + totals | 471 | 177 | h2h,spreads,totals | **177 × 30 = 5 310** |
| **FINAL_EVAL** 2025 w8–15 | **416** completed (count-only; not vendored) | ~156 est. | h2h,spreads | **~3 120** |
| Completed 2026 w1–15 | **~455** completed (count-only) | ~171 est. | h2h,spreads | **~3 400** |
| **All three (ML+spreads closes)** | — | — | — | **≈ 10 060** |

Early T−24h two-sided snaps (Coach CLV R1–R4): **+same order again** (~3–5k) if authorized — optional add-on, not required for engine M1–M4 / S1–S2.

ALT posted prices: `10 × markets × regions × events` per historical-event pull — defer until totals/ALT restore is in scope.

## Join / storage layout (when authorized)

```
test/fixtures/
  ncaaf-tuning-2025-w1-7-games.json          # ESPN free — PRESENT
  ncaaf-tuning-2025-w1-7-closing-lines.json  # Odds paid — NOT YET
  ncaaf-final-eval-2025-w8plus-games.json    # ESPN free — do not fetch until FINAL_EVAL run
  ncaaf-final-eval-*-closing-lines.json      # Odds paid — NOT YET
```

Never mix TUNING closes into FINAL_EVAL scoring. Never backfill injuries from live ESPN into historical rows.

## Activation steps (next purchase)

1. Human approve Odds historical spend (start with **TUNING only ≈ 3 540 credits** for h2h,spreads).  
2. Inject `ODDS_API_KEY` into agent/runner.  
3. Set `NCAAF_FORWARD_CREDIT_CAP` / E2b max-bucket caps ≥ 3540.  
4. Run `ncaafPhaseE2bClosingLines.py` against TUNING games only → write `ncaaf-tuning-2025-w1-7-closing-lines.json`.  
5. Re-score locked M1–M4 / S1–S4 on TUNING with research stamp (+ optional `NCAAF_RESEARCH_MARGIN_GAP_SCALE`).  
6. **Only after** TUNING pass candidates: fetch FINAL_EVAL ESPN+Odds and score once — no retune.

## Free vs paid this turn

| Work | Status |
|------|--------|
| ESPN TUNING games | **Done** (471) |
| Team-strength / matchup diag on TUNING | **Done** |
| Margin-gap scale research hook (default no-op) | **Done** |
| Odds closes TUNING / FINAL_EVAL | **Blocked** — needs key + spend approval |
| Gate / production OTA | **Unchanged** (blocked / frozen) |

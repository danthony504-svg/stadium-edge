# NCAAF restoration candidate — evidence pack

**Research tip:** `ncaaf-team-strength-v0-research` (opt-in) · prior drive research `ppg-per-drive-v1.1-research`  
**Live engine:** `nfl-drive:ppg-per-drive-v1` — **isolated; unchanged**  
**Product gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false` — **do not flip**  
**Ops:** No publish/deploy; voice paused; production OTA freeze armed. **E6 not requested.**

## Verdict: restore readiness **NO**

**Restoration attempt CLOSED** (2026-10-17) on the final identical-334 scorecard — see [`ncaaf-restoration-attempt-closed-334.md`](./ncaaf-restoration-attempt-closed-334.md).  

Prior drive-sim TUNING round also closed unsuccessful ([`ncaaf-tuning-round-closed-unsuccessful.md`](./ncaaf-tuning-round-closed-unsuccessful.md)).  

**Next (proposal only, no impl/spend):** [`ncaaf-team-strength-next-inputs-proposal.md`](./ncaaf-team-strength-next-inputs-proposal.md).

Per-market readiness is **independent**. Locked criteria are **not** lowered. TUNING is **not** independent acceptance proof.

| Market | Supported FBS–FBS (identical n=334) | Restore? |
|--------|-------------------------------------|----------|
| **Moneyline** | ts_after Δ ≈ 0.024 — **M3 FAIL**; drive Δ ≈ 0.050 — FAIL | **NO** |
| **Spreads** | ts_after ATS ≈ 0.257 — **S2 FAIL**; drive ≈ 0.273 — FAIL | **NO** |
| **Totals** | No `closeTotal` archive | **BLOCKED** |
| **ALTs** | No posted ALT prices | **BLOCKED** |

| Scope | Status |
|-------|--------|
| FBS–FBS (rated) | Screened; not ready |
| FBS–FCS | **Unsupported** — Coach withhold (85/421); not a validation pass |

## Holdout / split policy

| Window | Status |
|--------|--------|
| 2024 pre/post cutoff | **USED** — diagnosis only |
| **TUNING** 2025 w1–7 | ESPN + closes eval-only; identical-334 final scorecard **closed** |
| **FINAL_EVAL** 2025 w8+ / completed 2026 | **Untouched** — no fixture written |

Criteria: [`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md).

## Preserved research assets (do not discard)

- Verified season-specific FBS/FCS IDs + transitions  
- Chronological FBS–FBS-only ratings; unrated → null (no invented defaults)  
- Coach withhold helpers for unsupported/unrated  
- Regressions + reproducible compare scripts  
- Scorecards: [`ncaaf-tuning-identical-334-finish.md`](./ncaaf-tuning-identical-334-finish.md)

## Product focus (separate from NCAAF restore)

Return to **verifying and releasing already-tested Coach fixes for supported sports** on separate branches/PRs. NCAAF stays blocked / P0 armed / gate false. Production OTA freeze unchanged.

## What remains (no E6)

1. Human review of **next-inputs proposal** only (no spend until approved).  
2. If approved later: free ESPN inputs first; nested TUNING folds for selection; **single** FINAL_EVAL score after freeze — TUNING never cited as independent proof.  
3. Keep gate false; no deploy/OTA; voice paused.

# Reserved NCAAF evaluation set — acceptance criteria (locked before results)

**Locked:** 2026-10-16 · branch `cursor/ncaaf-phase-e-restore-8b51`  
**Rule:** Criteria are locked **before** examining any 2025 / completed-2026 scorecards. Do not edit thresholds after seeing numbers.  
**Live gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false`. Research path only (`ncaaf-team-strength-v0-research` / prior drive research opt-in).  
**Model params:** Locked in [`ncaaf-model-params-locked.md`](./ncaaf-model-params-locked.md) (residual 14.5, shrink 2.0, gap scale default 1.0, blend 0.5) **before** Odds close retrieval.  
**Status (2026-10-17):** Restoration attempt closed on identical-334 — criteria **unchanged**; FINAL_EVAL still empty. See [`ncaaf-restoration-attempt-closed-334.md`](./ncaaf-restoration-attempt-closed-334.md).  
**Clean research path (design only):** [`ncaaf-clean-engine-design.md`](./ncaaf-clean-engine-design.md) — same locked thresholds; rebuild ≠ automatic pass.

## Data availability (feasibility only — no retrieval yet)

| Source | 2025 FBS | Completed 2026 FBS | Notes |
|--------|----------|--------------------|-------|
| ESPN scoreboard / finals | **Obtainable** (public) | **Obtainable** for completed games | Not in current `ncaaf-phase-e-games.json` (2023–2024 only) |
| Odds API historical (paid) | **Obtainable** from 2020-06 onward | **Obtainable** for completed kickoffs | Requires `ODDS_API_KEY` + paid plan; **not fetched this turn** |
| Injury pre-kickoff labels | Only if forward freezes existed pre-kickoff | Same | Never backfill from live ESPN |

**Verdict:** A new evaluation set **can** be built from legitimate historical 2025 and completed-2026 Odds+ESPN joins **after** credentialed retrieval is authorized. Until then the reserved window stays **RESERVED_EMPTY**.

## Split: tuning vs final evaluation

| Split | Window (proposed) | Allowed uses |
|-------|-------------------|--------------|
| **TUNING** | 2025 weeks 1–7 (kickoff `< 2025-10-15T00:00:00Z`) | Residual/shrink/selection experiments only |
| **FINAL_EVAL** | 2025 weeks 8+ **plus** completed 2026 regular-season games with Odds closes | Frozen acceptance scoring only — **no retune** |

2024 USED windows (pre-cutoff + untouched @ e6c26f85) must **not** be reused for tuning or final eval.

## Locked acceptance criteria (FINAL_EVAL)

All required for any future `PASS` label on the reserved set. Measured only after fixtures exist.

### Moneyline (engine)

| # | Criterion | Threshold |
|---|-----------|-----------|
| M1 | Sample | `n ≥ 200` decided games with close ML |
| M2 | vs coin | `brierEngine < 0.25` |
| M3 | vs market | `brierEngine ≤ brierMarketClose + 0.02` |
| M4 | Bias | `\|meanP − meanY\| ≤ 0.08` |

### Spreads / ATS (engine @ close home line)

| # | Criterion | Threshold |
|---|-----------|-----------|
| S1 | Sample | `n ≥ 200` decided (pushes excluded) |
| S2 | vs coin | `brierEngine < 0.25` |
| S3 | Settlement | Sign/push/extraction audit CLEARED on same stamp |
| S4 | Market ATS | If close ATS juice present: report vs market; else coin-only (document MISSING_DATA) |

### Coach pick CLV (ML)

Reuse locked C1–C6 + R1–R4 from [`ncaaf-e2b-clv-acceptance-criteria.md`](./ncaaf-e2b-clv-acceptance-criteria.md) — **C2 `meanClv ≥ 0` unchanged** (no negative floor).

### Totals / ALTs / injury

| Market | Gate |
|--------|------|
| Totals | Require `closeTotal` archive; else `INSUFFICIENT_DATA` (not PASS) |
| ALTs | Require posted ALT prices; else `INSUFFICIENT_DATA` |
| E4 injury | Require `captureTimestamp < kickoff` joins; never coerce null→false |

### Product

| # | Criterion |
|---|-----------|
| P1 | Live stamp remains `ppg-per-drive-v1`; research opt-in only |
| P2 | `NCAAF_GAME_LINE_SIM_VALIDATED` stays false until human E6 on flag-only PR |
| P3 | No market enabled solely because another passes |

## Explicitly rejected

- Choosing CLV / Brier tolerances after seeing FINAL_EVAL numbers  
- Mixing TUNING into FINAL_EVAL after a fail  
- Backfilling 2024/2025 injury from current ESPN  

## Status

Criteria **LOCKED**.  

| Split | Fixture status (2026-10-16) |
|-------|------------------------------|
| TUNING ESPN games | **Present** — `ncaaf-tuning-2025-w1-7-games.json` (471) — score-only diags allowed |
| TUNING Odds closes | **Present** (470/471) — eval-only; M3/S2 **FAIL** on fair n=421; round **closed unsuccessful** |
| FINAL_EVAL games/closes | **Untouched** — not vendored; count-only probes only |
| Odds historical retrieval | Completed once for TUNING (session **3560** credits); no further spend without new approval |

Score-only TUNING diagnostics must not rewrite these thresholds. **M3** and **S2** remain frozen regardless of future close-joined results until a new explicit lock. Replacement work must not train on closes.

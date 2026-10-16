# NCAAF restoration candidate — evidence pack

**Research tip (evaluated):** `e6c26f85` — **research-only**  
**Live engine:** `nfl-drive:ppg-per-drive-v1` (Render `e607f131`) — **isolated; unchanged**  
**Research stamp:** `ppg-per-drive-v1.1-research` (opt-in only; see [`ncaaf-engine-isolation.md`](./ncaaf-engine-isolation.md))  
**Product gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false` — **do not flip**  
**Ops:** No publish/deploy; voice paused; production OTA freeze armed. **E6 not requested.**

## Verdict: restore readiness **NO** (no market enabled)

Per-market readiness is **independent**.

| Market | Used untouched (kickoff ≥ 2024-10-15) @ e6c26f85 research | vs coin | vs market | Restore? |
|--------|----------------------------------------------------------|---------|-----------|----------|
| **Moneyline** | n=411; Brier **0.210** | **beats** | **loses** (0.189) | **NO** |
| **Spreads** | n=384; Brier **0.264** | **fails** | N/A (no ATS juice) | **NO** |
| **Totals** | over@proj ~0.250 | beats | **no closes** | **NO** |
| **ALTs** | synthetic | mixed | **no prices** | **NO** |

## Holdout policy

**Entire 2024 evaluated window is USED** (pre-cutoff for research locks + post-cutoff for evaluation).  
**Reserved untouched:** 2025+ FBS forward collection — empty until collected.  
Do not retune residual/shrink/CLV thresholds on USED 2024 data.

## Failure analysis

Reproducible report: `ncaaf-phase-e-failure-analysis.json` + script `ncaafPhaseEFailureAnalysis.ts`.

| Class | Findings |
|-------|----------|
| **MODEL_WEAKNESS** | ATS discrimination (Brier>coin after bias fix); ML loses to close; Coach CLV mean&lt;0 |
| **MISSING_DATA** | Closing totals; ALT prices; ATS juice; T−24h two-sided early snaps; 2024 injury labels |
| **CLEARED** | Spread settlement sign/push/extraction/timing |

## Forward collection (not activated)

See [`ncaaf-forward-collection-plan.md`](./ncaaf-forward-collection-plan.md): Odds API credentials/cost, ESPN injury freezes, storage layout. **Do not** backfill historical injuries with current data.

## Engine isolation

Global `v1.1` stamp was reverted. Residual/shrink apply only under `ncaafResearchCalibration`. NFL live draws and stamp unchanged. Details: [`ncaaf-engine-isolation.md`](./ncaaf-engine-isolation.md).

## What remains (no E6 yet)

1. Forward collect reserved-untouched odds/injury (after human activates key).  
2. Model work only on **reserved** data — not USED 2024.  
3. Meet locked CLV C1–C6 under R1–R4 with real early two-sided prices.  
4. Then — and only then — consider E6 on a flag-only PR.

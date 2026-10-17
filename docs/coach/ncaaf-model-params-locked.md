# NCAAF model parameters + M3/S2 — locked before TUNING closes

**Locked:** 2026-10-16 · branch `cursor/ncaaf-phase-e-restore-8b51`  
**Rule:** Lock **before** any Odds historical retrieval or examination of close-joined scorecards. Do not edit after seeing M3/S2 numbers.  
**FINAL_EVAL:** Untouched (no fixtures, no Odds pull).  
**Paid retrieval:** Not authorized this turn (`ODDS_API_KEY` unset).

## Locked research engine parameters (scoring defaults)

These are the parameters that will be used when TUNING closes arrive. No retune from close results without a new explicit lock document.

| Parameter | Locked value | Notes |
|-----------|--------------|-------|
| Live stamp | `ppg-per-drive-v1` | Unchanged; NFL-safe |
| Research stamp | `ppg-per-drive-v1.1-research` | Opt-in only (`ncaafResearchCalibration` / `NCAAF_RESEARCH_CALIBRATION=1`) |
| Margin residual SD | **14.5** | `FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD` — USED 2024 pre-cutoff lock |
| Home margin shrink | **2.0** | `FOOTBALL_NCAAF_HOME_MARGIN_SHRINK` — same lock |
| Research margin gap scale (default) | **1.0** | `FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT` — no-op |
| Offense/defense blend | **0.5** | Best score-only Brier on TUNING; not reopened after closes without new lock |
| Gate | `NCAAF_GAME_LINE_SIM_VALIDATED = false` | No flip |

### Documented candidates (NOT locked for restore / primary score)

Score-only TUNING sweeps proposed gap scales **1.45** (best ML Brier) and **1.6** (first synthetic fair-line ATS &lt; coin). These remain **research sweep env overrides** (`NCAAF_RESEARCH_MARGIN_GAP_SCALE`) only. Primary close-joined scoring uses **1.0**. Do not promote a candidate until TUNING closes pass locked M3/S2 at the chosen scale, then re-lock explicitly before FINAL_EVAL.

## Locked acceptance criteria (reaffirmed)

From [`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md) — thresholds frozen:

| # | Criterion | Threshold |
|---|-----------|-----------|
| **M3** | vs market (ML) | `brierEngine ≤ brierMarketClose + 0.02` |
| **S2** | vs coin (ATS) | `brierEngine < 0.25` |

Also locked (not relaxed by this turn): M1/M2/M4, S1/S3/S4, C1–C6, R1–R4, P1–P3.

## Eval-only closes (no pregame feature leak)

Historical closing snapshots (`closeMl*`, `closeSpread*`, snapshot timestamps) are **evaluation join inputs only**:

| Allowed | Forbidden |
|---------|-----------|
| M1–M4 / S1–S4 scoring | Pregame drive-sim / matchup feature vectors |
| CLV close reference | Training / residual inputs derived from closes |
| Settlement / extraction audits | Live Coach product sim inputs |

Closing lines must **not** leak into features that produce the engine probabilities being scored against those same closes.

## Status

| Item | State |
|------|-------|
| Params + M3/S2 | **LOCKED** (this doc) |
| TUNING ESPN games | Present (471) |
| TUNING Odds closes | Absent — dry-run only |
| FINAL_EVAL | **UNTOUCHED** |
| Gate / deploy / OTA | Unchanged / frozen |

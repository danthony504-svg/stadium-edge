# ML-only harness — TUNING screen (Phase A)

**Candidate:** frozen clean E1 **α=1.15**  
**Generated:** 2026-10-17T12:17:11.714Z  
**Split:** TUNING (screen only) · **FINAL_EVAL scored:** false  
**Spreads:** BLOCKED (separate gate — S2 does not auto-fail ML)  
**Ops:** no spend · no deploy/OTA/unlock · voice paused · gate false

## Locked criteria (unchanged)

M1 n≥200 · M2 Brier&lt;0.25 · M3 ≤ mkt+0.02 · M4 |bias|≤0.08 · CLV C1–C6 (C2 meanClv≥0)

## TUNING screen metrics

| Metric | Value |
|--------|------:|
| nML | 334 |
| ML Brier | 0.195481766550902 |
| Mkt Brier | 0.17665292452674916 |
| Δ vs mkt | 0.01882884202415283 |
| bias | -0.06561379002329726 |

## Criterion results (screen — not FINAL_EVAL PASS)

- **M1**: pass=true · nMl=334
- **M2**: pass=true · mlBrier=0.195481766550902
- **M3**: pass=true · deltaVsMarket=0.01882884202415283
- **M4**: pass=true · bias=-0.06561379002329726

### CLV

- **C1**: missing · pass=null · Clean E1 CLV missing — early two-sided cache empty; phase-e prior fail is failed evidence on old stamp only
- **C2**: missing · pass=null · Clean E1 CLV missing — early two-sided cache empty; phase-e prior fail is failed evidence on old stamp only
- **C3**: missing · pass=null · Clean E1 CLV missing — early two-sided cache empty; phase-e prior fail is failed evidence on old stamp only
- **C4**: missing · pass=null · Clean E1 CLV missing — early two-sided cache empty; phase-e prior fail is failed evidence on old stamp only
- **C5**: missing · pass=null · Clean E1 CLV missing — early two-sided cache empty; phase-e prior fail is failed evidence on old stamp only
- **C6**: missing · pass=null · Clean E1 CLV missing — early two-sided cache empty; phase-e prior fail is failed evidence on old stamp only

## Acceptance

`finalPass=false` — TUNING screen cannot issue FINAL_EVAL PASS (locked policy)

## Notes

- TUNING ML screen only — M3 true here is not FINAL_EVAL PASS
- Closes used as eval labels only — not in predict features
- Spreads/S2 out of scope for this harness

Withholds: `{}`

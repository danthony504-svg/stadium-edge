# FINAL_EVAL frozen score (once)

**Authorized:** yes · **Paid HTTP:** 0 · **Retuned:** false · **Deploy/OTA/unlock:** false  
**Stamp:** `ncaaf-score-margin-v1-research` · **Candidate:** E1_alpha_1_15 α=1.15  
**Membership:** 408 preserved · **Paired coverage:** 403/408 · **Empty shells missing:** 5  
**Spreads:** BLOCKED

## Exclusions / sample

| Item | n |
|------|--:|
| Membership | 408 |
| Paired early+close two-sided | 403 |
| Empty bookmakers (explicit missing) | 5 |
| M1 scored (decided + close ML + evaluable) | 403 |
| Coach ML CLV picks | 278 |
| Harness withholds | {} |
| CLV skips | {"no_qualify_edge":125} |

Empty bookmaker IDs: 401756933, 401752886, 401752771, 401752776, 401754604

## M1–M4 (engine moneyline)

| # | Criterion | Measured | Pass |
|---|-----------|----------|:----:|
| M1 | 200 | 403 (nMl=403) | true |
| M2 | 0.25 | 0.18244176980067497 (mlBrier=0.18244176980067497) | true |
| M3 | <= market + 0.02 | 0.0046818505342073324 (deltaVsMarket=0.0046818505342073324) | true |
| M4 | 0.08 | -0.019446726172758 (bias=-0.019446726172758) | true |

| Metric | Value | Bootstrap SE |
|--------|------:|-------------:|
| ML Brier | 0.18244176980067497 | 0.00938 |
| Market Brier | 0.17775991926646764 | — |
| Δ vs market | 0.0046818505342073324 | 0.00433 |
| meanP / meanY / bias | 0.5363845393359269 / 0.5558312655086849 / -0.019446726172758 | — |

## Coach C1–C6 (ML CLV, R1–R4)

| # | Result | Detail |
|---|--------|--------|
| C1 | pass=true · passed | nMlWithClv=278 |
| C2 | pass=true · passed | meanClv=0.0017845390265699645 |
| C3 | pass=true · passed | pctBeatClose=0.45323741007194246 |
| C4 | pass=true · passed | home=114 away=164 |
| C5 | pass=true · passed | softGatesOk=true |
| C6 | pass=true · passed | E2b_coachPickClv=PASS eligible |

Soft gates (same stamp): **PASS_SOFT_GATES_ONLY** (n=403, engineBrier=0.18244176980067497, mktBrier=0.17775991926646764, meanGap=-0.03549629397068137)  
meanClv SE≈0.00136

## Acceptance

`finalPass=false` — Unmet: mlAll=true clvAll=true e4=false  
mlAllPass=true · clvAllPass=true · E4 injury validated=false

## Notes

- Closes used as eval labels only — not in predict features
- Spreads/S2 out of scope for this harness
- No retuning against FINAL_EVAL
- Human E6 still required before any gate flip

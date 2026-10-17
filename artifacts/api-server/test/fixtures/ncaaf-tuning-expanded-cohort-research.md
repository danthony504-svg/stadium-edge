# TUNING expanded-cohort research (fair n)

**FINAL_EVAL:** untouched · **Gate:** false · **Paid retrieval:** none · **Closes in features:** no

## Fair compare cohort
- TUNING games with full close ML+spread (post 57-game rematch): **n = 421**
- All models use this identical set (model n: {"locked_drive_engine":421,"margin_history_mean":421,"opp_adj_rating":421,"opp_adj_rating_time_ordered_slope":421})
- Still missing closes: 1

## Strength-input audit
| Check | Result |
|-------|--------|
| Pregame timing | Causal `walkHoldoutGames` (prior games only; kickoff+4h / completedAt) |
| Future leakage | None — ratings updated after prediction |
| teamMean 50/50 blend | mean|blended|/mean|rawOffenseGap| (|raw|≥3): **0.932** (n=358); mean|raw|=10.27 → mean|blended|=9.44 |
| Score-rate cap binds | **0.0%** of cohort; large-gap≥14: {"n":98,"rateCapBinds":0} |
| Early-season thin form (w1–3, nForm<3) | 46 |
| FCS opponent in cohort (name heuristic) | 45 |
| Provenance | {"venue_split":418,"venue_l10_blend":2,"last10":1} |

**Compression mechanism:** `teamMean(for, oppAgainst)` halves offense-only gaps before the drive sim; defense tilt is unused in this offline path (no yards packs). Score-rate cap (0.98) rarely binds — **mean blending**, not the cap, is the primary compressor.

## Models on identical n=421

| Model | ML Brier | Market | Δ | M3 | ATS Brier | S2 | corr(margin) | meanPred/Act |
|-------|---------:|-------:|--:|:--:|----------:|:--:|-------------:|-------------:|
| locked_drive_engine | 0.2016 | 0.1501 | 0.0515 | false | 0.2943 | false | 0.484 | 8.5/10.7 |
| margin_history_mean | 0.1967 | 0.1501 | 0.0466 | false | 0.2918 | false | 0.524 | 6.0/10.7 |
| opp_adj_rating | 0.1824 | 0.1501 | 0.0324 | false | 0.3122 | false | 0.514 | 3.8/10.7 |
| opp_adj + time-ordered slope | 0.1828 | 0.1501 | 0.0327 | false | 0.3122 | false | 0.514 | 3.8/10.7 |

## Time-ordered slices
See JSON `timeOrderedValidation.byWeek` / `byFavoriteSize`.

## Conclusion
- **Meaningful gains vs locked M3/S2:** false
- **Recommend model replacement:** true
- No candidate reaches locked M3/S2 on the fair n=421 cohort. Best ML (opp-adj) still Δ=0.032 vs market; ATS worsens vs drive engine. teamMean blending compresses offense gaps; score-rate caps never bind. Incremental drive-path levers are exhausted — replace the research model architecture (not a residual/gap scalar).
- Gate flip: **false** · FINAL_EVAL: **UNTOUCHED**

## Repro
```bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1500 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningExpandedCohortResearch.ts
```

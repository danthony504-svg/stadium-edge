# Clean engine M2 report — `ncaaf-score-margin-v1-research`

**Generated:** 2026-10-17T11:25:16.809Z  
**Split:** TUNING 2025 w1–7 only · **FINAL_EVAL:** UNTOUCHED  
**No closes in features · no Odds spend · gate false · freeze armed · voice paused**

> **Naming (superseding):** `releaseEligible` was renamed to `evaluableSupported` — research inputs complete enough to score, **not** production approval (`productionReleaseApproved=false`). This snapshot is **pre–venue-sidecar** (all venues unknown → evaluableSupported=0). Post-sidecar counts: `ncaaf-clean-m2-m3-screen.md` (evaluableSupported=350).

## Counts

| Metric | n |
|--------|--:|
| TUNING games | 471 |
| FBS–FBS rows | 352 |
| ok predictions (rated FBS–FBS) | 350 |
| evaluableSupported (was releaseEligible) | 0 |
| venue.kind=unknown | 471 |
| injury_unavailable (on ok) | 350 |
| tied/invalid finals (on ok path) | 0 |

### Withhold reasons

```json
{
  "fbs_fcs_unsupported_scope": 119,
  "unrated_fbs_side": 2
}
```

## Score-only residual (informational)

| | |
|--|--:|
| n | 350 |
| mean (actual−pred margin) | 6.111 |
| RMSE | 18.123 |

Not an M3/S2 claim.

## Data blockers before M3

- **venue_fields_absent** (eval blocker then): TUNING/phase-e game fixtures lack venueKind/neutralSite fields — all rows recover as venue.kind=unknown → evaluableSupported=false. Sidecar recovery landed after this snapshot.
- **injury_snapshots_absent** (validation_gap): No pre-kick injury snapshots on historical TUNING — injury_unavailable on all ok preds. Allowed for research; does not satisfy E4 injury validation.
- **close_totals_alt_absent** (market_gap): closeTotal / ALT archives still absent — totals/ALT remain INSUFFICIENT_DATA (unchanged).
- **final_eval_untouched** (policy): FINAL_EVAL fixtures not built — correct until candidate lock after M3 screen.

## Next

Historical next-step note (done): venue sidecar recovered; M3 screen + identical-ID compare/ablations in `ncaaf-clean-m2-m3-screen.md` / `ncaaf-clean-compare-ablation.md`.

# FBS–FCS withhold: 119 (M2 walk) vs 85 (fair identical-334)

**Date:** 2026-10-17  
**Verdict:** **Cohort difference — not a classification error.**

## Counts

| Cohort | Definition | n games | FBS–FCS withhold |
|--------|------------|--------:|-----------------:|
| Full TUNING ESPN | `ncaaf-tuning-2025-w1-7-games.json` | **471** | **119** |
| Fair close-joined | Usable close ML+spread cohort used for identical-334 (`fairCohortN=421`) | **421** | **85** |
| Identical-334 | Fair ∩ rated FBS–FBS after verified IDs | **334** | 0 (those already excluded) |

Subdivision tags on the full 471: `fbs_fbs=352`, `fbs_fcs=119`, unknowns=0 ([`ncaaf-subdivision-retag.md`](./ncaaf-subdivision-retag.md)).

## Arithmetic

```
119 − 85 = 34   extra FBS–FCS only on full ESPN set (no usable closes / outside fair)
352 − 336 = 16  extra FBS–FBS on full set (336 = 421 − 85)
34 + 16 = 50 = 471 − 421
```

Identical-334 exclusions from fair 421: FBS–FCS **85** + unrated **2** → 334.

## Classification check

Same verified season-specific ESPN FBS/FCS IDs (`ncaaf-subdivision-espn-ids.json`) drive both counts. The M2 walk withheld **119** because it scored **all** TUNING ESPN rows. The earlier fair cohort withheld **85** because it only considered close-joined fair games. No retag mismatch required to explain the gap.

## Implication for M3

M3 TUNING screening should report both:

1. **Supported screen set** — FBS–FBS + rated + verified venue (`releaseEligible`) joined to closes (eval-only).  
2. Optional footnote of full-ESPN FBS–FCS = 119 vs fair FBS–FCS = 85 for continuity with identical-334 docs.

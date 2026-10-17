# TUNING: subdivision classification fix — before/after

**Stamp unchanged:** `ncaaf-team-strength-v0-research` · drive locked · FINAL_EVAL untouched · gate false · no paid Odds · no new model

## What changed

- **BEFORE:** name-heuristic FCS set (missed 50+ FCS; false-tagged Delaware as FCS in 2025); silent default-24 μ
- **AFTER:** season-specific ESPN FBS/FCS IDs; seed/update only verified FBS–FBS; chronological rebuild; unrated → explicit TS exclusion (no invented defaults)
- Drive model: **unchanged** (control).
- Seeded teams: before=191 · after=134 · TS after exclusions (unrated)=87

## Slice metrics

### `all_fair` (n=421)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 421 | 0 | 0.2021 | 0.0520 | false | 413 | 0.2936 | false | -2.2 |
| `ts_before_legacy` | 421 | 0 | 0.1926 | 0.0425 | false | 413 | 0.2787 | false | -6.7 |
| `ts_after_verified` | 334 | 87 | 0.2002 | 0.0235 | false | 326 | 0.2571 | false | -2.5 |

### `fbs_fbs` (n=336)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 336 | 0 | 0.2258 | 0.0502 | false | 328 | 0.2755 | false | 0.8 |
| `ts_before_legacy` | 336 | 0 | 0.1949 | 0.0193 | true | 328 | 0.2562 | false | -2.8 |
| `ts_after_verified` | 334 | 2 | 0.2002 | 0.0235 | false | 326 | 0.2571 | false | -2.5 |

### `fbs_fcs` (n=85)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 85 | 0 | 0.1084 | 0.0591 | false | 85 | 0.3633 | false | -13.8 |
| `ts_before_legacy` | 85 | 0 | 0.1836 | 0.1344 | false | 85 | 0.3657 | false | -22.1 |
| `ts_after_verified` | 0 | 85 | — | — | null | 0 | — | null | — |

### `week1` (n=86)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 86 | 0 | 0.1776 | 0.0816 | false | 86 | 0.3073 | false | -7.5 |
| `ts_before_legacy` | 86 | 0 | 0.1948 | 0.0987 | false | 86 | 0.2838 | false | -11.0 |
| `ts_after_verified` | 47 | 39 | 0.2089 | 0.0718 | false | 47 | 0.2412 | true | -3.3 |

### `large_14plus` (n=167)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 167 | 0 | 0.1346 | 0.0773 | false | 167 | 0.3354 | false | -10.8 |
| `ts_before_legacy` | 167 | 0 | 0.1443 | 0.0871 | false | 167 | 0.3130 | false | -14.2 |
| `ts_after_verified` | 94 | 73 | 0.1322 | 0.0581 | false | 94 | 0.2636 | false | -6.6 |

### `fbs_fbs_week1` (n=48)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 48 | 0 | 0.2301 | 0.0959 | false | 48 | 0.2643 | false | -3.6 |
| `ts_before_legacy` | 48 | 0 | 0.2052 | 0.0709 | false | 48 | 0.2440 | true | -4.2 |
| `ts_after_verified` | 47 | 1 | 0.2089 | 0.0718 | false | 47 | 0.2412 | true | -3.3 |

### `fbs_fbs_large_14plus` (n=96)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 96 | 0 | 0.1669 | 0.0943 | false | 96 | 0.2989 | false | -7.3 |
| `ts_before_legacy` | 96 | 0 | 0.1262 | 0.0536 | false | 96 | 0.2692 | false | -7.0 |
| `ts_after_verified` | 94 | 2 | 0.1322 | 0.0581 | false | 94 | 0.2636 | false | -6.6 |

### `identical_after_scored` (n=334)

| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |
|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|
| `locked_drive` | 334 | 0 | 0.2267 | 0.0500 | false | 326 | 0.2734 | false | 0.9 |
| `ts_before_legacy` | 334 | 0 | 0.1955 | 0.0189 | true | 326 | 0.2549 | false | -2.6 |
| `ts_after_verified` | 334 | 0 | 0.2002 | 0.0235 | false | 326 | 0.2571 | false | -2.5 |

## Notes

- **FBS–FCS after:** all excluded from team-strength (unrated FCS — no invented defaults). Drive still scores them.
- **`identical_after_scored`:** same event IDs for before vs after (excludes the 87 unrated-after games) so Δ is not confounded by cohort change.
- Legacy before can look stronger on some slices while still **polluted** (unflagged FCS in seed/update, silent defaults). Not an acceptance path.

## Conclusion

- Classification defect addressed with verified season-specific IDs + chronological FBS–FBS rebuild.
- Gate flip: **false**. FINAL_EVAL: **UNTOUCHED**. No deploy/OTA. No new model yet. Criteria unchanged.

## Repro
```bash
cd artifacts/api-server
node --import ./test/register-hooks.mjs ./scripts/ncaafRetagSubdivision.ts
NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningSubdivisionFixCompare.ts
```
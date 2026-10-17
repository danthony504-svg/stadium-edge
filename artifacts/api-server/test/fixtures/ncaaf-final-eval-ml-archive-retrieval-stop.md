# FINAL_EVAL ML archive retrieval — STOPPED

**Status:** `STOPPED_NO_KEY` · **Credits consumed:** **0** · **FINAL_EVAL scored:** false  
**Spreads:** blocked · **Voice:** paused · **Deploy/OTA/NCAAF unlock:** false  
**No purchase / upgrade**

## Access (no value exposure)

| Check | Result |
|-------|--------|
| `ODDS_API_KEY` | **ABSENT** |
| `CLOUD_AGENT_ALL_SECRET_NAMES` | `EXPO_TOKEN` |
| `CLOUD_AGENT_INJECTED_SECRET_NAMES` | `EXPO_TOKEN` |

## Caps (authorized, unused)

| Pull | Hard cap | Spent |
|------|----------|-------|
| Close h2h | 2100 | 0 |
| Early T−24h two-sided h2h | 2100 | 0 |
| Combined | 4200 | 0 |

## Coverage

| Metric | Value |
|--------|-------|
| Matched games (close) | 0 |
| Matched games (early) | 0 |
| Timestamp validity | NOT_RUN |
| Missing data | **all** — retrieval not started |
| Coverage | **INCOMPLETE** |

## Preserved

Membership (408) · E1 α=1.15 · Coach R1–R4/C1–C6 · manifests 2100+2100≤4200

## Next

1. Add `ODDS_API_KEY` in Cloud Agent environment Secrets (same name as Render).  
2. Start a **new** agent run so injection applies.  
3. Re-run `ncaafCleanFinalEvalMlArchivePull.py` with `NCAAF_FINAL_EVAL_PULL=1`.

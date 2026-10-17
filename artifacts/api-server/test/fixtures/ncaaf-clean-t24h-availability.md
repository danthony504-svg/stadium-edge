# Historical T−24h availability check (no price deltas)

**Generated:** 2026-10-17T13:11:57.309Z  
**Coach selection rules:** **LOCKED** (`ncaaf-clean-coach-selection-rules-locked.md`) **before** this check  
**Price early−close differences examined:** **false**  
**Paid fetch:** false

## Odds API

| Item | Status |
|------|--------|
| `ODDS_API_KEY` | **missing** |
| Unauth probe `/v4/sports` | HTTP 401 |
| Historical endpoint | paid-only `/v4/historical/.../odds` |
| Snapshot cadence (docs) | 5-minute since Sep 2022 |
| T−24h timing for FINAL_EVAL 2025–26 | **Feasible** on paid historical plans |

## Local coverage

| Archive | n |
|---------|--:|
| Early snapshot files | 0 |
| Close snapshot files | 0 |
| FINAL_EVAL membership games | 408 |
| Selection-prices fixture rows | 705 (away ML fields present: false) |

## Implication

Early two-sided cache is **empty**. Without a key, historical entitlement is **unconfirmed**. Fixture home-only fallback does not satisfy locked R2 for away selections. **Do not** inspect early vs close prices until after authorized retrieval.

Ops: E1 frozen · injuries inactive · NCAAF blocked · voice paused · FINAL_EVAL unscored

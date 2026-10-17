# Odds request manifests (Phase C/D) — dry-run only

**Generated:** 2026-10-17T12:17:47.447Z  
**Paid retrieval:** **false** · ODDS_API_KEY unset · no plan changes

## Separate hard credit caps

| Manifest | Markets | Buckets to fetch | Base credits | Retry buffer | **Hard cap** | Fits |
|----------|---------|-----------------:|-------------:|-------------:|-------------:|:----:|
| Close-only h2h | h2h | 70 | 700 | 175 | **2000** | true |
| Early T−24h h2h CLV | h2h | 70 | 700 | 175 | **2200** | true |

Caps are **independent**. Do not spend one against the other without new approval.

## Deduplication

| Source | Close manifest | Early CLV manifest |
|--------|----------------|--------------------|
| TUNING close minute buckets | 176 known; skip overlap | not applicable (different as-of) |
| File cache | `/opt/cursor/artifacts/ncaaf-e2b-close-snapshots` (n=0) | `/opt/cursor/artifacts/ncaaf-e2b-early-snapshots` (n=0) |
| Buckets skipped | 0 | 0 |

## Timing / coverage limitations

### Close-only h2h
- date= kickoff truncated to UTC minute
- API returns closest snapshot ≤ date (5-minute intervals)
- Reject snapshotTimestamp >= commence after retries → MISSING_DATA
- Midday slate snaps are not closes
- ⚠ h2h only — no spreads/totals/ALTs in this manifest
- ⚠ Requires paid Odds historical plan; ODDS_API_KEY unset here
- ⚠ FINAL_EVAL membership must be FBS–FBS filtered at score time
- ⚠ Does not include early T−24h (see CLV manifest)
- ⚠ TUNING close archive buckets skipped only when identical minute bucket overlaps (rare for FINAL_EVAL)

### Early two-sided CLV
- date= kickoff − 24h truncated to UTC minute
- Need two-sided American ML (home+away) from real books
- R1: fixture home-only fallback insufficient for C1 on clean path
- R2: away ML only from this early cache
- Selection timestamp must be recorded for CLV
- ⚠ Early snapshot cache currently EMPTY (0 files)
- ⚠ Home-only selection-prices fixture cannot supply away ML under R1–R2
- ⚠ Separate hard cap from close-only manifest — do not co-mingle spend
- ⚠ Phase-e CLV fail (n=15, meanClv<0) is failed evidence on prior stamp — remake on clean E1 after cache exists
- ⚠ Paid historical only; key unset — manifest is pre-retrieval

## Non-actions this turn

No HTTP to Odds API · no FINAL_EVAL scoring · no deploy/OTA/unlock · spreads remain blocked

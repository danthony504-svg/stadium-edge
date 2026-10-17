# Retrieval readiness — after membership reconcile + T−24h check

**Generated:** 2026-10-17  
**Paid fetch this turn:** **false** · **FINAL_EVAL scored:** false  
**E1:** frozen α=1.15 · injuries inactive · NCAAF blocked · voice paused · spreads blocked

## Checklist

| Gate | Status |
|------|--------|
| FINAL_EVAL membership reconciled to complete ESPN **date** schedule | **Yes** — included **408** (was 132 week-board); +276 documented; 0 dropped |
| Exclusions structural only (no model performance / no 2025 outcome filters) | **Yes** |
| Coach selection C1–C6 + R1–R4 locked **before** price-delta inspection | **Yes** — `ncaaf-clean-coach-selection-rules-locked.md` |
| Early vs close price differences examined | **No** (forbidden until after lock + authorized pull) |
| T−24h historical timing feasible (post–Sep 2022) | **Yes** (docs) |
| Local early snapshot archive | **Empty** (0 files) |
| `ODDS_API_KEY` present | **No** |
| Manifests regenerated + deduped | **Yes** |
| Close hard cap / Early hard cap / Combined max | **2100** / **2100** / **4200** |
| Each pull fits own cap (base+25% retry) | **Yes** (1670+418=2088 ≤ 2100) |
| Combined base+retry if both run | **4176 ≤ 4200** |

## Retrieval readiness verdict

**NOT READY to fetch** — blocked by missing `ODDS_API_KEY` (and empty early cache).  

**READY to authorize** once key + paid historical entitlement are confirmed: dry-run manifests and caps are in place; membership and Coach rules are locked.

## Credit plan (when authorized)

| Pull | Markets | Buckets | Base | Hard cap |
|------|---------|--------:|-----:|---------:|
| Close-only h2h | h2h | 167 | 1670 | **2100** |
| Early T−24h h2h | h2h | 167 | 1670 | **2100** |
| Combined ceiling | — | — | 3340 | **4200** |

## Artifacts

- `ncaaf-final-eval-membership.md` / `-reconcile.json`  
- `ncaaf-clean-t24h-availability.md`  
- `ncaaf-final-eval-odds-request-manifests.md`  
- `ncaaf-clean-coach-selection-rules-locked.md`  

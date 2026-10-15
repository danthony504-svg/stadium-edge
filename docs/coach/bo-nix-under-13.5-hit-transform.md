# Exact transform: raw 0.9705 → displayed model estimate

**Athlete / event:** `4426338` / `401872995` SEA@DEN · Under 13.5 rush yds @ −108  
**n=5** uncalibrated · Telegram ingest **UNVERIFIED** · Build 78 crash attribution **UNVERIFIED**  
**No deploy / OTA**

## What 0.9705 → 0.98 was **not**

| Wrong label | Why wrong |
|-------------|-----------|
| Soft-cap raised 0.9705 to 0.98 | Soft-cap only *lowers* invented certainty (`≥1 → 0.98`). It cannot increase a value. |
| Stale cache | Dist identity excludes line/side; same draw scores alts. Not a cache replay of 0.98. |
| Different run | Seeded MC Under count **9705/10000** is reproducible. |

## Exact arithmetic (MC board path)

```
rawHit     = 0.9705                     # 9705/10000 Under hits
tilt       ≈ +0.38                      # SEA soft-stingy (+0.30) + weak own YPC (+0.08)
desired    = clamp(tilt × 0.06, ±0.05)   # ≈ +0.0228
transfer   = min(desired, 1 − rawHit)   # mass from Over/complement only
adjusted   = round3(rawHit + transfer)  # ≈ 0.993 · in [0, 1]
```

Paired: `Over' + Under' + push' = 1` (push untouched). Opposite tilt on Over demotes it by the same transfer.

**Increase = matchup mass transfer.** Certainty soft-clip (`1 → 0.98`) stays in empirical graders only.

Prior bug: `Math.min(0.98, hit+adj)` (1) raised mid-high hits via a ceiling labeled “soft-cap”, and (2) flattened alt Unders (13.5 and 15.5 both → **0.98**).

UI: `model 99.3% (sim 97.1% +2.2pp matchup); n=5, uncalibrated` · `rawSimHit` + `simHit` · one apply (`oppMatchupAppliedToSim` skips cache/recovery re-tilt).

## Props-only path (separate)

5/5 Under → empirical `1.0` → **certainty soft-clip 0.98** *before* tilt → then tilt may soft-clip again at ≥1 → still **0.98**. That 0.98 is a true soft-clip of a perfect sample, not a tilt raise.

## Display / grading consistency (fix)

| Surface | Value |
|---------|--------|
| `rawSimHit` | Pre-matchup MC / empirical |
| `simHit` | **Final model estimate** (post-tilt) — used for edge, EV, grade, qualification |
| Simulation factor text | e.g. `99.3% hit (raw 97.1% +2.3pp matchup; n=5, uncalibrated)` |

## Over / Under + alt monotonicity

- Under uses `P(X < line)`; Over `P(X > line)` on the **same** samples.
- After fix, same Under tilt keeps `adj(9.5) ≤ adj(11.5) ≤ adj(13.5) ≤ adj(15.5)`; only exact `1.0` soft-clips to 0.98.

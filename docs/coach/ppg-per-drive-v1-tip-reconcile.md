# Tip vs verified `ppg-per-drive-v1` — reconcile (do not restore blindly)

**Tip branch:** `cursor/prop-defense-index-perside-8b51` @ `540c5a28`.  
**Verified pack SHA:** `1f9cc04a` / dual holdout pin `014ec192`.  
**Live Render (verified 2026-10-16):** `deploymentSha=ddeb4733348b98d7112748edc19c7e06fc6fc99a` → game-outcome `engineVersion=ppg-per-drive-v1`.  
**Prod OTA tip (frozen):** `b666165e`.  
**Constraints:** NCAAF game lines stay P0-blocked. No publish / deploy. Do not cherry-pick engine blindly.

## Verdict (updated after live probe)

| Surface | Tip branch today | Live Render `ddeb4733` | Verified pack | Action |
|---------|------------------|------------------------|---------------|--------|
| Server `nflDriveSim` | Hard-cap TD/FG **0.42 / 0.28**; no tilt | Soft rates + matchup + PPG→drives | Same as Render | **Missing on tip server** — deploying tip API would **regress** live |
| Server `engineVersion` stamp | Absent on tip tree | **`ppg-per-drive-v1`** on NFL game-outcome | Same | **Live OK**; tip lacks modules |
| Mobile stamp reject | Absent (tip + prod OTA) | Present on Render mobile tree | Present | **Missing on tip/OTA mobile** — add after preview wiring |
| Mobile per-opp prop `defenseIndex` | **Present (this PR)** | Absent | N/A (props) | Tip-only win; needs server dist-cache key fix for full trust |
| `NCAAF_GAME_LINE_SIM_VALIDATED` | `false` | `false` | `false` | **Aligned — keep false** |

## What is missing from **tip branch server** (vs live / pack)

1. Soft-monotonic rate map (`footballDriveScoringRates` past knee)  
2. `applyDefenseTiltToOffenseMean` (±8%, sample≥2)  
3. PPG / drives conversion (`footballDriveRateInput` → `ppg / n`)  
4. Engine stamp modules (`footballDriveMatchup`, `gameSimEngineVersion`)  
5. College-aware drive defaults where pack differs  

**Do not** copy onto tip blindly — port/rebase onto `ddeb4733` (or merge pack) and re-holdout on the shipping stamp.

## What is missing from **tip / prod-OTA mobile** (vs Render mobile tree)

1. Client `gameDrawEngineAccepted` / `gameSimEngineVersion` stamp reject  
2. Optional: Phase E gate tests beside the flag  

## Live server gap (props) — remaining before preview trust

`propDistributionCacheKey` omits `defenseIndex`. Extreme boost then suppress for the same player returned identical cached means. Per-opp batches help different players; same-player/context changes can cross-contaminate. Fix dist key (or bake matchup into fingerprint) before preview publication relies on per-opp defense under warm cache.

## What tip already has (keep)

- Prop MC wiring + per-opponent defense keys (`game@@opp:teamId`)  
- College P0 ask-only exit + clarification copy  
- `NCAAF_GAME_LINE_SIM_VALIDATED = false`  
- FB weather/injury proposals unit-tested, not live  

## Forbidden

- Flip `NCAAF_GAME_LINE_SIM_VALIDATED` to return college team-market picks  
- Publish production OTA / deploy tip API (would regress `ppg-per-drive-v1`)  
- Assume tip hard-cap engine matches off-tip holdout PASS numbers  

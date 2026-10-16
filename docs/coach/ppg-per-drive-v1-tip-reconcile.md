# Tip vs verified `ppg-per-drive-v1` — reconcile (do not restore blindly)

**Tip branch:** `cursor/prop-defense-index-perside-8b51` (from college-audit lineage).  
**Verified pack SHA (elsewhere):** `1f9cc04a` / dual holdout pin `014ec192`.  
**Constraints:** NCAAF game lines stay P0-blocked. No publish / deploy. Do not cherry-pick engine blindly.

## Verdict

| Surface | Tip today | Verified pack (`1f9cc04a`) | Action |
|---------|-----------|----------------------------|--------|
| Server `nflDriveSim` | Hard-cap TD/FG **0.42 / 0.28**; means fed as ppd; **no** defense tilt | Soft rates + `footballDriveMatchup`; PPG→drives→ppd; stamp `ppg-per-drive-v1` | **Missing on tip server** — do not flip NCAAF until ported + re-holdout |
| Server `gameSimEngineVersion` / stamp reject | Absent / no football stamp gate | `FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"`; reject unstamped draws | **Missing on tip server** |
| Mobile Coach P0 `NCAAF_GAME_LINE_SIM_VALIDATED` | `false` (armed) | `false` (armed) | **Aligned — keep false** |
| Mobile early-exit + blocked-sim copy | Present (college audit) | Present on football-unit lineage | **Tip has honesty path** |
| Mobile stamp reject before cache/grade | Not on tip | Client rejects missing/wrong `engineVersion` | **Missing on tip mobile** — only needed after server ships stamp |
| Phase E holdout harness/fixtures | Absent | Present off-tip | **Missing** — see `ncaaf-game-line-missing-evidence.md` |

## What is missing from **live server** (vs pack)

If production Render still tracks tip-like hard-capped `nfl-drive` (confirm via `deploymentSha` / healthz):

1. Soft-monotonic rate map (`footballDriveScoringRates` past knee)
2. `applyDefenseTiltToOffenseMean` (±8%, sample≥2)
3. PPG / drives conversion (`footballDriveRateInput` → `ppg / n`)
4. Engine stamp on game-outcome responses
5. College-aware drive defaults (where pack differs)

**Do not** restore these onto tip by blind copy — unit-mismatch PASS was withdrawn once; any port needs a fresh holdout on the shipping stamp.

## What is missing from **mobile** (vs pack)

1. Client `COACH_GAME_SIM_ENGINE_VERSION` / stamp reject (only after server emits stamp)
2. Optional: Phase E gate tests living beside the flag
3. **Not missing for this task:** per-opponent `defenseIndex` for **props** (fixed on this branch)

## What tip already has (keep)

- Prop MC `defenseIndexByFamily` / MLB `weatherImpact` wiring
- Per-opponent defense keys (`game@@opp:teamId`) — this PR
- College P0 ask-only exit + clarification copy (preview-ready)
- `NCAAF_GAME_LINE_SIM_VALIDATED = false`

## Forbidden

- Flip `NCAAF_GAME_LINE_SIM_VALIDATED` to return college team-market picks
- Publish production OTA / deploy API from this audit
- Assume off-tip E2a numeric PASS applies to tip hard-cap engine

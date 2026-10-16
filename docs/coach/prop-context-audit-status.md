# Coach prop-context audit status — opponent / weather / field / injury

**Focus return:** original Coach audit (not NCAAF restore).  
**As of:** 2026-10-16 · research branch docs; live Render still on prior server tip lineage.  
**Sources:** `isolated-pair-verify.md`, `candidates-finalize-for-review.md`, `two-candidate-verify.md`.

## Verified (changes projected distribution)

| Factor | Verified behavior |
|--------|-------------------|
| **Opponent `defenseIndex`** | Pre-sim mean via `computeOpponentMatchupShift`; per-opp batches on **mobile candidate**; server candidate fingerprints `defenseIndex` in dist cache |
| **MLB `weatherImpact`** | Enters prop MC for `sport===mlb` only; dome / `climateControlled` → null |
| **Venue / field (H/A series)** | `computeVenueShift` / `venueFamilyMult` when series exists |
| **Injury Opportunity Shift** | OUT/doubtful vacancy → mean; never invent “healthy” from silence |
| **Key-injury soft scalar** | Opp injuries raise mean; own lower; own suppressed when Opp Shift owns fingerprint (no double-count) |
| **MLB park `hrIndex`** | Nudges outdoor `weatherImpact` only |

## Unsupported / not live

| Factor | Status |
|--------|--------|
| **NFL/NCAAF prop MC weather** | Holistic only; `proposeFootballWeatherImpact` unit-tested, **not wired** to MC |
| **Retractable MLB roof open/closed** | Always dome-neutral via `dome: true` |
| **Football turf/grass** | Display/holistic; **not** in prop MC |
| **Football game-line weather/injury in `nflDriveSim`** | **Unsupported** in draws (pts means + optional defense pack tilt on drive path) |
| **Server injury side assignment** | Still opp=away / own=home for whole game (away-home invert risk) |

## Mobile fixes still awaiting production

Production freeze remains armed — **no production OTA**. Preview may have been published on other tips; production channel is not these candidates.

| Candidate work | Branch / tip (docs) | Production status |
|----------------|---------------------|-------------------|
| Per-opp `defenseIndex` + prop context pipeline | `cursor/mobile-peropp-stamp-8b51` / paired mobile tip | **Awaiting production OTA** |
| Engine stamp reject (`ppg-per-drive-v1`) | same | **Awaiting production OTA** (preview may differ) |
| College honesty / NCAAF P0 surfaces | same | Gate false; **prod must keep blocked** |
| Delivery-commit fulfilled telemetry / digest | mobile candidate tip | **Awaiting production OTA** |
| Server prop dist cache identity (`defenseIndex` in fingerprint) | `cursor/prop-dist-cache-identity-8b51` | **Awaiting Render deploy** (live was behind candidate at finalize time) |

**Not in those diffs (correctly frozen):** voice / STT / TTS, home shortcuts UI, passkey changes.

## Invariants

- `NCAAF_GAME_LINE_SIM_VALIDATED = false`  
- Voice paused  
- Production OTA freeze armed  
- No deploy / OTA in this turn  

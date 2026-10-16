# Coach prop-context audit status — opponent / weather / field / injury

**Focus:** original Coach audit (not NCAAF restore).  
**As of:** 2026-10-16 · preview closeout for mobile tip `54b89f32` / export-equivalent update `01a146ed…`  
**Audit status:** **IN PROGRESS — not complete.** Verified rows below are partial; remaining gaps stay open.

**Sources:** `isolated-pair-verify.md`, `candidates-finalize-for-review.md`, `two-candidate-verify.md`, `preview-release-verification-54b89f32.md`, `production-mobile-candidate-54b89f32.md`.

## Verified so far (changes projected distribution)

| Factor | Verified behavior |
|--------|-------------------|
| **Opponent `defenseIndex`** | Pre-sim mean via `computeOpponentMatchupShift`; per-opp batches on **mobile candidate** `54b89f32`; live Render `e607f131` fingerprints `defenseIndex` in dist cache |
| **MLB `weatherImpact`** | Enters prop MC for `sport===mlb` only; dome / `climateControlled` → null |
| **Venue / field (H/A series)** | `computeVenueShift` / `venueFamilyMult` when series exists |
| **Injury Opportunity Shift** | OUT/doubtful vacancy → mean; never invent “healthy” from silence |
| **Key-injury soft scalar** | Opp injuries raise mean; own lower; own suppressed when Opp Shift owns fingerprint (no double-count) |
| **MLB park `hrIndex`** | Nudges outdoor `weatherImpact` only |

## Remaining gaps (do not treat as closed)

| Factor | Status |
|--------|--------|
| **NFL prop MC weather** | **Remaining gap** — holistic / proposal only; `proposeFootballWeatherImpact` **not wired** into prop MC |
| **Football turf / grass** | **Remaining gap** — display/holistic only; **not** in prop MC |
| **Retractable / open-roof MLB** | **Remaining gap** — retractables always dome-neutral via `dome: true`; no open-roof / roof-open-today branch |
| **Football game-line weather/injury in `nflDriveSim`** | Unsupported in draws (pts means + optional defense pack tilt on drive path) |
| **Server injury side assignment** | Still opp=away / own=home for whole game (away-home invert risk) |

## Mobile production candidate (awaiting authorized OTA)

Preview verified; production freeze remains armed — **no production OTA yet**.

| Item | Identity |
|------|----------|
| Candidate tip | `54b89f32efc81fe3cf56cee50388816054484600` |
| Preview update ID (export-equivalent) | `01a146ed-1a89-71f5-9e5a-5909a432a38f` · hash `2ecBll…` |
| Rollback target | `b666165e…` / update `01a144bd…` / group `68de9f95…` |
| Package | [`production-mobile-candidate-54b89f32.md`](./production-mobile-candidate-54b89f32.md) |

Included: per-opp `defenseIndex`, stamp reject, college honesty (gate false), delivery-commit fulfilled (one success, no false freeze).  
**Not in candidate:** voice / STT / TTS, home shortcuts UI, passkey changes.

## Invariants

- `NCAAF_GAME_LINE_SIM_VALIDATED = false`  
- Voice paused  
- Production OTA freeze armed  
- Forward collector dry-run only (`NCAAF_FORWARD_ACTIVATE` unset)  
- No production publish in the preview closeout turn  

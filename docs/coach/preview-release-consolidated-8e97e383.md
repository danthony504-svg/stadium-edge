# Consolidated preview release — review only

**Full tip SHA:** `78f8370b3263d45999304a440c629a2f0067aa0d`  
**Code tip (matchup invariants):** `8e97e3839873324558f441de9ba13c6f32df26f4`  
**Branch:** `cursor/coach-players-only-kb-8b51` · PR #741  
**Status:** Prepared for preview review — **no publication, deploy, merge, or native build**

---

## UNVERIFIED (do not close)

| Item | Status |
|------|--------|
| Telegram device-event ingestion for the 3-of-10 shortfall | **UNVERIFIED** |
| Build 78 IPS crash attribution (vs any tip / today’s OTA) | **UNVERIFIED** |

---

## What this tip contains (Coach)

1. **Opponent context once** — matchup tilt applied to `simHit`; Final AI tendency display-only when `oppMatchupAppliedToSim`
2. **Paired Over↔Under transfer** — `over + under + push ≈ 1`; hits in `[0,1]`; alt Under ladder monotone (no shared 0.98 flatten)
3. **Raw + adjusted retained** — `rawSimHit` / `simHit`; edge, grade, qualification, UI use **adjusted**; UI shows `model X% (sim Y% ±Zpp matchup); n=5, uncalibrated`
4. **Cache/recovery** — second attach skips tilt when `oppMatchupAppliedToSim`
5. **P0 telemetry** — `P0_UNVALIDATED_MARKETS` digests as legitimate underfill (no Telegram page)
6. **Bo Nix audit** — raw 0.9705 → model ~0.993 via matchup transfer (n=5 uncalibrated); not soft-cap raise
7. D/ST ask locks + Tackles+Assists grade (earlier commits on branch)

---

## Focused test results (this run)

| Suite | Result |
|-------|--------|
| `simHitMatchupAdjust.test.ts` (paired, push, alt mono, alreadyApplied) | **4/4 pass** |
| `footballOppContextPipeline.verify.test.ts` (identity, one-apply, alts, board, recovery, cold/warm, Bo Nix) | **9/9 pass** |
| `footballRushDefense.test.ts` (incl. team-defense warm cache) | **pass** (bundled run **45/45** with pipeline + adjust) |
| `api-server` `coachReliability.test.ts` (P0 digest-only, 3-of-10 no page) | **18/18 pass** |

**Consistency check** (`adjusted-value-consistency.json`):

| Check | Result |
|-------|--------|
| `finalAiScore.simHit` === adjusted (0.993) | ✓ |
| `finalAiScore.rawSimHit` === raw (0.9705) | ✓ |
| Edge from adjusted | ✓ |
| `pickHasSimGrade` on adjusted | ✓ |
| Qualification on adjusted | ✓ |
| UI label === simulation factor display | ✓ |
| Recovery `alreadyApplied` keeps same adjusted | ✓ |
| Paired O+U+push sum | **1.000** |

---

## Cold / warm Coach timing (identical fixtures)

Measured at code tip `8e97e383` on this agent host (not device wall-clock):

| Path | Cold | Warm | Notes |
|------|-----:|-----:|-------|
| Team-defense context cache (3→2 concurrent) | **28.3 ms** | **~0 ms** | 1 network fill; warm memory hit |
| Scoring 200×6 markets (tip one-application) | — | **17.8 ms** | `oppMatchupAppliedToSim: true` |
| Scoring 200×6 markets (parent double-count) | — | **13.1 ms** | tendency re-scored; tip still within 1.5×+50 gate |

**Interpretation:** Cache cold/warm behavior unchanged (coalesce + hit). Tip scoring is same order as parent; no extra network or MC. Full device Coach ask walls were **not** re-measured in this turn (no live scan).

Artifacts: `/opt/cursor/artifacts/coach-cold-warm-timing.json`, `adjusted-value-consistency.json`, `matchup-adjust-focused-tests.log`

---

## Deploy scope (when approved — not now)

| Surface | Needed? | Why |
|---------|---------|-----|
| **Client preview OTA** | **Yes** (primary) | `footballRushDefense`, `finalAiScore`, `pickScoreContext`, `ScoreBreakdown`, props-only ticket, P0 client map |
| **API server deploy** | **Yes** (for P0 ingest + reliability parity) | `coachReliabilitySanitize` P0 → digest-only; without it, server still drops unmapped P0 POSTs |
| Native / EAS build | **No** | JS-only |
| Production OTA | **No** | Preview review only; production freeze posture unchanged |
| Telegram / Build 78 | **No action** | Remain UNVERIFIED |

**Recommendation:** Preview channel OTA **and** API deploy of this tip (or a tip that includes both) before device validation. Order: API first (ingest), then preview OTA (client). **Neither is authorized in this turn.**

---

## Review gates before any publish

- [ ] Human review of PR #741 consolidated tip
- [ ] Confirm preview channel + runtime `1.1.0` / installed preview-build78 IPA
- [ ] Device: paired O/U display, n=5 label, shortfall note, no ErrorRecovery loop
- [ ] Do **not** treat Telegram silence or Build 78 as resolved

**No publication · no deploy · no merge · no native build**

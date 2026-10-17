# Isolated mobile×server candidate verification

**Date:** 2026-10-16  
**Server candidate:** `416093020e5a835cf2854b1801f2737c7c64dce1` (`cursor/prop-dist-cache-identity-8b51`, base `ddeb4733`)  
**Mobile candidate:** `fc433d7e0bb18965ac17ebf3d7bf1c0c2b7e3c37` (`cursor/mobile-peropp-stamp-8b51`, base `b666165e`)  
**Harness:** local `:8791` — in-process server-candidate `runPropSims` / game-outcome; other routes proxied to live Render. Stamp **`ppg-per-drive-v1`**.  
**Constraints:** NCAAF blocked · voice paused · freeze armed · **no deploy / no OTA**

## 1. Boost / suppress cache separation (complete prop path + ALT + replacement)

Against isolated server candidate:

| Case | Mean | Hit | ALT Over rates | Cache |
|------|------|-----|----------------|-------|
| Lawrence boost (1.14) | **271.45** | 0.733 | 214.5→0.828 … 254.5→0.609 | miss |
| Lawrence suppress (0.88) | **216.61** | 0.379 | 214.5→0.521 … 254.5→0.264 | miss (separate key) |
| Identical boost reuse | 259.71 | 0.662 | — | **hit, draws=0** |
| Omit defense | 241.67 | 0.550 | — | miss (≠ boost/suppress) |

Both teams + replacement WR (Brian Thomas Jr.) carried ALT `additionalLines` → `lineHitRatesBySide.Over`. Home/away real packs produced distinct per-family indices; Stroud reused boost pass cache, Mixon reused suppress rush cache when real indices matched those keys.

Artifact: `/opt/cursor/artifacts/isolated-boost-suppress.json`, `isolated-two-team-alt-replacement.json`.

## 2. Full Coach scan cold/warm (repeated, comparable)

`buildCoachParlay({ askText: "5 leg", requestedLegs: 5 })` — **not** API subset.

| Mobile | Backend | Cold ms | Warm ms | Legs |
|--------|---------|---------|---------|------|
| Candidate | **Isolated harness** pass1 | **43 845** | 30 163 | 5/5 |
| Candidate | **Isolated harness** pass2 | **36 880** | 35 063 | 5/5 |
| Baseline OTA `b666165e` | **Same harness** | **45 079** | 35 236 | 5/5 |
| Candidate (prior) | Live Render | 62 912 | 25 834 | 5/5 |

Harness baselines in harness file: phase1 51.3s/20.3s; prePhase2 42s/27.7s.

### Cold-increase investigation (no threshold deferral, no sim/qualification weaken)

1. **Mobile candidate is not slower than OTA baseline on the same backend.** Cold 36.9–43.8s vs baseline 45.1s.  
2. **Live 62.9s cold** is dominated by live `gameSimulation` stage wall (~78.6s parallel miss work) + `teamDefense` ~17.5s — backend/slate load, not the mobile +2634 diff.  
3. Stage parity (harness cold): same call counts for espn/injuries/history/defense/gameSim; baseline alone recorded `teamPeriodStats` (112 calls / ~22.5s) which candidate did not surface in the same snapshot — wall still favors candidate.  
4. Warm on harness (~30–35s) is **higher** than live warm (25.8s) because live retains warm game-sim entries; harness/proxy starts colder. Not used to claim a pass by weakening qualification.

**Threshold stance:** Keep measuring; do not invent a softer fail bar or reduce sims to “pass.” Candidate vs baseline on identical harness shows **no cold regression from the mobile diff.**

## 3. Mobile diff +2634/−112 scope

Approx. vs `b666165e` (tip includes verify docs → ~2701/112):

| Category | +add | −del | Files | Role |
|----------|------|------|-------|------|
| **Runtime** | **1372** | **111** | 14 | `propContextPipeline`, `boardMarketScanner`, `api`, `pickScoreContext`, stamp (`gameSimEngineVersion`, `coachGameMonteCarlo`, `gameSimScoring`), college honesty (`coachP0*`, `buildParlay`, `coachAskSportScope`), small holistic/reliability |
| **Tests** | **941** | **1** | 9 | two-team defense, pipeline, stamp, college audit, scoring |
| **Docs** | **388** | **0** | 4 | PROP_CONTEXT audit, college audit, tip reconcile, two-candidate verify |
| **Voice / home shortcuts / passkeys** | **0** | **0** | 0 | **None changed** |

Runtime is ~51% of added lines; tests ~35%; docs ~14%. No voice/STT/TTS/expo-av; passkey files untouched.

## 4. Context audit — weather / field / injury

| Factor | Changes projected distribution (MC mean)? | Ranking / display only? | Unsupported / not live |
|--------|--------------------------------------------|-------------------------|-------------------------|
| **Opponent `defenseIndex`** | **Yes** — `computeOpponentMatchupShift` → pre-sim mean (per-opp on mobile candidate) | Holistic Opponent Tendency **score** suppressed when projection owns key; Match display kept | — |
| **MLB `weatherImpact`** | **Yes** — only `sport===mlb` in `monteCarlo` / server strips non-MLB | Holistic Weather still scores | — |
| **NFL/NCAAF weather** | **No** in prop MC today (`weatherImpactFromGameEnv` null) | **Yes** — holistic temp/wind/precip/dome | `proposeFootballWeatherImpact` unit-tested, **not wired** to MC |
| **Venue / field (H/A series)** | **Yes** — `computeVenueShift` / `venueFamilyMult` when series exists | Surface/dome bits via football weather display | Park surface heuristic not in prop MC |
| **Injury Opportunity Shift** | **Yes** — OUT/doubtful vacancy → mean | — | Never invent “healthy” from silence |
| **Key-injury soft scalar** (`oppKeyInjuries`/`ownKeyInjuries`) | **Yes** — mean tilt (own suppressed when Opp Shift owns fingerprint) | Holistic Injury rubric separate | Server still assigns opp=away/own=home for whole game (away invert risk) |
| **Minutes L5/season** | **Yes** — basketball-like | — | — |
| **Football game-line weather/injury/defense packs** | **No** in `nflDriveSim` draws | Game-line holistic injury lean only | Drive sim uses pts means (+ pack defense tilt on **server candidate** / live ppg-v1), not Coach prop packs |

## 5. Non-actions

- No Render deploy of server candidate  
- No OTA of mobile candidate  
- `NCAAF_GAME_LINE_SIM_VALIDATED=false`  
- Voice paused; production freeze remains armed  

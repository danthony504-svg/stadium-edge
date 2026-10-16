# Coach prop-context pipeline audit (thorough)

**Date:** 2026-10-16  
**Branch tip:** includes `propContextPipeline.ts` (+ tests) wired through `simPropPoolUntilQualified`.  
**Scope:** Opponent defense, weather, venue/field, injuries/lineups for Coach **prop** simulations across sports; gap check vs NCAAF/NFL **game-line** `nflDriveSim`.  
**Constraints:** Do **not** flip `NCAAF_GAME_LINE_SIM_VALIDATED`. No publish / deploy / OTA.

Status codes used below:

| Code | Meaning |
|------|---------|
| **F** | Fetched on Coach board path (or server hot path) |
| **P** | Enters prop Monte Carlo projection mean / pre-sim |
| **T** | Post-sim hit-probability tilt |
| **H** | Holistic grading and/or Match display |
| **G** | Hard qualification gate (drop/block before stage) |
| **—** | Not applicable / never invented when absent |

Missing policy (global): omit / unknown — **never invent** healthy, weather, or positional “allows X” splits.

---

## 1. Pipeline order

1. Prefetch (parallel in `buildParlay`): injuries, opp team-defense packs, MLB platoon/park env, football park weather, optional matchup history / early player history.  
   Citations: `coach/buildParlay.ts:412-473`, `footballOppDefenseContext.ts:52-186`, `footballScanContext.ts:107-162`, `coachBoardContext.ts:55-88`.
2. `simPropPoolUntilQualified` builds per-game `weatherImpactByGame` + `defenseIndexByFamilyByGame` from already-fetched maps (no per-player network).  
   Citations: `boardMarketScanner.ts:901-966`, `propContextPipeline.ts:187-277`.
3. `fetchPropSimulations` → `POST /sports/simulate/props` → `runPropSims` / `buildProjectionMean` (Opportunity × Venue × Opponent Matchup + MLB weather + injury scalars).  
   Citations: `api.ts:2157-2308`, `simulate.ts:287-340`, `monteCarloBuild.ts:211-286`, `monteCarlo.ts:177-272`.
4. `attachPickScores` / `buildFinalAiScore` — post-sim opp-D tilt guard + holistic factors.  
   Citations: `pickScoreContext.ts:894-938`, `propHolisticRecommendation.ts:311-340`, `propContextPipeline.ts:283-287`.

---

## 2. Per-factor × per-sport matrix

Legend cells: `F / P / T / H / G` (or `—`). Notes in parentheses.

### 2.1 Opponent defense

| Sport | Fetched? | Projection MC? | Post-sim tilt? | Holistic / display? | Missing policy |
|-------|----------|----------------|----------------|---------------------|----------------|
| **NFL** | **F** — `GET /sports/team-defense` rush+pass box scores (`footballOppDefenseContext.ts:24-33,100-122`) | **P** — `defenseIndexByFamilyFromPack` → `defenseIndexByFamily` → `computeOpponentMatchupShift` (`propContextPipeline.ts:101-127`, `opponentMatchup.ts:82-103`, `monteCarloBuild.ts:212-248`) | **T skipped** when game in `projectionDefenseGames` (`boardMarketScanner.ts:945-947`, `pickScoreContext.ts:894-903`, `shouldApplyPostSimOppDefenseTilt`) | **H** Match display kept; **score suppressed** when projection owns D (`propHolisticRecommendation.ts:331-335`). Soft/hard tilt from pack still used for **G** blocks (`footballRushDefense.ts:364+`, `boardMarketScanner.ts:595-611`) | Thin sample `<3` → null index (`propContextPipeline.ts:104-114`); no pack → matchup 1.0 / tilt 0 |
| **NCAAF** | **F** same path as NFL | **P** same baselines (`propContextPipeline.ts:59-64`) | Same double-count guard | Same | Same; college **player** props only when `askAllowsNcaafPlayerProps` (`buildParlay.ts:370-377`) |
| **MLB** | **F** — ERA/WHIP/BAA on pack (`footballOppDefenseContext.ts:172-174`) | **P** — ERA→hits/HR/TB/RBI/runs index (`propContextPipeline.ts:155-164`) | Guard applies if fam non-empty | **H** team ERA tilt + preferred pitcher tendency when present (`footballRushDefense.ts:839-864`, `propHolisticRecommendation.ts:343+`) | No ERA → omit |
| **NBA / WNBA / NCAAB** | **F** — `avgPointsAgainst` + steals/blocks/dreb (`footballOppDefenseContext.ts:123-163`) | **P** — pointsAgainst→points/threes/pra only (`propContextPipeline.ts:128-134`) — **not** assists/rebounds families | Guard if fam present | **H** pts + steals/dreb/blocks soft tilt (`footballRushDefense.ts:721-759`); no hard block | No `pointsAgainst` → omit index |
| **NHL** | **F** — GAA/SV%/SA (`footballOppDefenseContext.ts:164-167`) | **P** — GAA→goals/points/shots (`propContextPipeline.ts:135-145`) | Guard if fam present | **H** + **G** elite SV%/GAA hard-block Goals/Points Overs; rare ≥1.5 Over drop if no goalie context (`footballRushDefense.ts:772-790,661-680`) | No GAA → omit index |
| **Soccer** | **F** — goalsConceded/cleanSheets (`footballOppDefenseContext.ts:169-171`) | **P** — per-game rate only if `gamesPlayed ≥ 5` (`propContextPipeline.ts:146-154`) | Guard if fam present | **H** season-total thresholds (not per-game) (`footballRushDefense.ts:815-836`) | Missing GP → omit index (never invent rate) |

**Fetch cap:** max 24 teams, football priority (`footballOppDefenseContext.ts:20-21,39-46,90-93`).

### 2.2 Weather

| Sport | Fetched? | Projection MC? | Post-sim tilt? | Holistic / display? | Missing policy |
|-------|----------|----------------|----------------|---------------------|----------------|
| **MLB** | **F** — park/OWM via `loadMlbScanContext` when MLB props present (`buildParlay.ts:418-426`) | **P** — `weatherImpactFromGameEnv` → `buildProjectionMean` only if `sport===mlb` (`propContextPipeline.ts:187-236`, `monteCarlo.ts:254-258`; server also strips non-MLB: `simulate.ts:287-290`) | — | **H** `scoreWeather` park HR index / temp / wind (`propHolisticRecommendation.ts:176-178,246-304,474-476`) | Dome/climate → null MC impact (`propContextPipeline.ts:195`); missing temp+precip → null |
| **NFL** | **F** — `/weather/parks` (`footballScanContext.ts:107-162`) merged into `mlbGameEnv` (`buildParlay.ts:469-473`) | **—** `weatherImpactFromGameEnv("nfl",…)` always null (`propContextPipeline.ts:192-193`) | — | **H** temp/wind/precip/dome/surface (`propHolisticRecommendation.ts:265-297`; tests `footballWeatherHolistic.test.ts`) | No readings → weather factor absent |
| **NCAAF** | **F** same as NFL | **—** same | — | **H** same | Same |
| **NBA / WNBA / NCAAB / NHL / Soccer** | **—** no weather fetch for props | **—** | — | **—** `weatherApplicable` false (`propHolisticRecommendation.ts:176-178`) | N/A |

### 2.3 Venue / field

| Sport | Fetched? | Projection MC? | Post-sim tilt? | Holistic / display? | Missing policy |
|-------|----------|----------------|----------------|---------------------|----------------|
| **All prop sports (with history)** | Home/away series from player history (server) | **P** — `computeVenueShift` → `venueFamilyMult` / `combinedPreSimMult`; soft H/A blend suppressed when venue ≠ 1 (`preSimShift/venue.ts`, `preSimShift/index.ts:79-123`, `monteCarlo.ts:223-231`) | — | Surface/dome bits via weather display (football); MLB park HR index via weather | Insufficient series → factor 1.0 (`venue.ts` early return) |
| **MLB parks** | Static park + hrIndex in env | HR index nudges **weatherImpact** score (`propContextPipeline.ts:224-229`) then MC | — | Holistic weather | Missing park → no HR nudge |
| **NFL/NCAAF surface** | Heuristic from park name when API omits (`footballScanContext.ts:54-65,71-78`) | **—** not in prop MC | — | Display in weather bits | Unknown surface → omit bit |

### 2.4 Injuries / lineups

| Sport | Fetched? | Projection MC? | Post-sim tilt? | Holistic / display? | Missing policy |
|-------|----------|----------------|----------------|---------------------|----------------|
| **All ESPN sports on board** | **F** — `loadBoardInjuries` / `getInjuries` (`coachBoardContext.ts:55-79`) | **P** (a) Opportunity Shift OUT/doubtful only (`confirmation.ts:2-20`, `fromInjuries.ts:108-115`); (b) `oppKeyInjuries`/`ownKeyInjuries` soft mean tilt (`monteCarlo.ts:250-252`); (c) minutes L5/season for basketball-like (`monteCarlo.ts:242-248`) | — | **H** prop injury rubric (`pickScoreContext.ts` `propInjuryScore`); game lines use matchup injury lean (`pickScoreContext.ts:270-276`) | Empty status → `unknown`, vacancy 0 — **never healthy** (`confirmation.ts:3-4`, `propContextInjuryHonesty.test.ts`, `auditPropContextFactors` `propContextPipeline.ts:344-351`) |
| **MLB lineups / probables** | Via MLB scan / platoon | Pitcher tendency + platoon in holistic; not a separate MC injury channel | — | **H** | Ambiguous name → unknown |

---

## 3. Double-count risks remaining

### Fixed (this pipeline)

1. **Opp D in MC + post-sim hit tilt + holistic score** — post-sim tilt skipped and holistic Opponent Tendency **score** suppressed when `projectionDefenseGames` has the game; display retained.  
   Citations: `propContextPipeline.ts:279-287`, `pickScoreContext.ts:894-903`, `propHolisticRecommendation.ts:331-335`, `preSimShift/index.ts:122-123` (soft vs-opp blend suppress).

### Remaining

| Risk | Severity | Detail | Citations |
|------|----------|--------|-----------|
| **Game-scoped `defenseIndexByFamily` from first pick’s opponent** | **High** | Loop keys by game once; first ranked prop’s opponent pack becomes the only family map for **both** sides. Opposite-side props get wrong D in MC **and** lose post-sim/holistic score tilt. | `boardMarketScanner.ts:909-945`; server consumes game-level map `monteCarloBuild.ts:212-215`, `simulate.ts:319-339` |
| **MLB weather in MC + holistic Weather factor** | Medium | Same env drives `weatherImpact` mean multiply and `scoreWeather` composite — intentional dual channels but double influence on final grade. | `monteCarlo.ts:254-258`, `propHolisticRecommendation.ts:474-476` |
| **`oppKeyInjuries` / `ownKeyInjuries` not flipped by `isHome`** | Medium | Server sets opp=away, own=home for the whole game; away players get inverted injury scalar. | `simulate.ts:284-285`, `coachSlateInProcessSims.ts:187-188`, `monteCarloBuild.ts:266-267` |
| **Opportunity Shift × key-injury scalar × holistic Injury** | Low–Med | Own-injury suppress when Opp Shift fingerprint applies (`opportunitySuppressOwnInjuries`); holistic Injury still scores separately (grading). | `monteCarlo.ts:250-252,57-58`, `propHolisticRecommendation.ts:508-514` |
| **Soccer holistic vs projection units** | Low | Holistic uses season **totals** thresholds; projection uses per-game rate with GP≥5 — can disagree. | `footballRushDefense.ts:818-821` vs `propContextPipeline.ts:146-154` |
| **NBA assist/reb: holistic only** | Low | Index families omit assists/rebounds; tilt still scores steals/dreb in holistic — not double-count, but asymmetric. | `propContextPipeline.ts:128-134`, `footballRushDefense.ts:735-744` |
| **Hard Over blocks still fire when projection owns D** | Intentional | Qualification gate uses pack tilt independently of `oppDefenseInProjection`. | `boardMarketScanner.ts:603-611` |
| **Slate in-process props** | Medium | `runPropSimsInProcess` forces `weatherImpact: null` even if defenseIndex passed. | `coachSlateInProcessSims.ts:189` |

---

## 4. Gaps vs NCAAF / NFL **game-line** sims (`nflDriveSim`)

| Question | Answer | Citations |
|----------|--------|-----------|
| Do opp-defense **packs** enter score draws? | **No.** Drive sim uses only `ptsFor` / `ptsAgainst` team means (season form), not Coach team-defense packs or `defenseIndexByFamily`. | `nflDriveSim.ts:42-67` |
| Does **weather** enter score draws? | **No** for nfl-drive. `SportSimContext.weatherImpact` exists but `runNflDriveSim` never reads it. MLB inning sim **does** apply weather. Generic fallback applies MLB-only weather in `runGameMonteCarlo`. | `nflDriveSim.ts` (no weather refs); `types.ts:10`; `mlbInningSim.ts:34-40`; `gameMonteCarlo.ts:172-176`; `registry.ts:43-44,52-61` |
| Do **injuries** enter score draws? | **No.** Game outcome path loads team history scores only (`coachSlateInProcessSims.ts:289-309`). Injuries affect game-line **holistic** injury lean, not draws. | `pickScoreContext.ts:270-276` |
| Venue / home split in drive sim? | Only insofar as history splits feed `ptsFor`/`ptsAgainst` into the request — no explicit venue multiplier in `nflDriveSim`. | `nflDriveSim.ts:44-45` |
| NCAAF game lines under P0? | **Fail-closed** while `NCAAF_GAME_LINE_SIM_VALIDATED === false` — bare college asks never reach slate MC. **Do not flip.** Props remain a separate opt-in surface. | `coachP0UnvalidatedTotals.ts:23,37-40`; `PROP_CONTEXT_PIPELINE_AUDIT` college notes; `COACH_8_LEG_COLLEGE_AUDIT.md` |
| NFL game lines | Still open to slate sims; engine saturation caveat documented on `nflDriveSim.ts:1-7`. Weather/injury still not in draws. | |

**Contrast:** Prop MC (this audit) can take defenseIndex + MLB weather + Opp Shift; football **game-line** MC cannot. Football prop weather is holistic-only by design (`propContextPipeline.ts:192`).

---

## 5. Concrete citation index (claims → file:line)

| Claim | File:line |
|-------|-----------|
| Pipeline pure helpers; never invent | `propContextPipeline.ts:1-7` |
| Sport defense baselines | `propContextPipeline.ts:47-71` |
| NFL/NCAAF index from rush/pass sample≥3 | `propContextPipeline.ts:101-127` |
| NBA/WNBA/NCAAB pointsAgainst index | `propContextPipeline.ts:128-134` |
| NHL GAA index | `propContextPipeline.ts:135-145` |
| Soccer GP≥5 per-game goals | `propContextPipeline.ts:146-154` |
| MLB ERA index | `propContextPipeline.ts:155-164` |
| WeatherImpact MLB-only; football null | `propContextPipeline.ts:192-193`, tests `propContextPipeline.test.ts:104-111` |
| Dome → null weatherImpact | `propContextPipeline.ts:195`, test `:87-95` |
| Post-sim tilt guard API | `propContextPipeline.ts:283-287` |
| Injury audit never “healthy” | `propContextPipeline.ts:344-351`, test `:172-201` |
| Board builds wx/def maps | `boardMarketScanner.ts:901-966` |
| Pass maps into `fetchPropSimulations` | `boardMarketScanner.ts:440-447`, `api.ts:2290-2305` |
| Mark `projectionDefenseGames` | `boardMarketScanner.ts:459-463,945` |
| Skip post-sim tilt in scoring | `pickScoreContext.ts:894-903` |
| Holistic suppress score / keep display | `propHolisticRecommendation.ts:331-335` |
| Merge football+MLB env | `buildParlay.ts:469-473` |
| Prefetch defense sports set | `footballOppDefenseContext.ts:24-33`, `buildParlay.ts:434-440` |
| Football weather fetch | `footballScanContext.ts:107-162` |
| MC weather MLB-only | `monteCarlo.ts:254-258` |
| MC injury + preSim combine | `monteCarlo.ts:250-270` |
| defenseIndex → matchup shift | `opponentMatchup.ts:82-103`, `monteCarloBuild.ts:212-248` |
| Venue shift | `preSimShift/venue.ts`, `preSimShift/index.ts:79-91` |
| Server rejects non-MLB weatherImpact | `simulate.ts:287-290` |
| Vacancy unknown = 0 | `confirmation.ts:2-20` |
| nflDriveSim no weather/injury/pack | `nflDriveSim.ts:42-67` |
| NCAAF gate armed | `coachP0UnvalidatedTotals.ts:23` |

---

## 6. Recommended next audit fixes

### Docs-only (safe now)

1. **Document game-scoped defenseIndex limitation** in this file / Coach runbooks: opposite-side props may share the first pick’s opponent index until per-side maps land.  
2. **Document intentional MLB weather dual-channel** (MC + holistic) vs football holistic-only.  
3. **Document nflDriveSim gap**: game-line score draws ≠ prop context packs; NCAAF game lines stay P0-blocked.  
4. Keep **`NCAAF_GAME_LINE_SIM_VALIDATED=false`** until Phase E — do not flip from this audit.

### Code changes needed (not done here)

| Fix | Why | Suggested shape |
|-----|-----|-----------------|
| **Per-side / per-player `defenseIndexByFamily`** | Wrong opponent D on shared game key | Key by `game#playerTeamId` or resolve from each prop’s `opponentTeamId` on server; stop first-pick freeze in `boardMarketScanner.ts:911` |
| **Flip `oppKeyInjuries`/`ownKeyInjuries` by `isHome`** | Away props inverted | In `buildPropSimulationContext` / `monteCarloBuild` swap when `isHome===false` |
| **Optional: suppress holistic Weather score when `weatherImpact` entered MC** | MLB double influence | Mirror `oppDefenseInProjection` pattern |
| **Wire slate `weatherImpact`** | `runPropSimsInProcess` always null | Pass through like HTTP simulate |
| **Soccer holistic per-game rates** | Align with projection | Use `goalsConceded/gamesPlayed` when GP present |
| **NBA assist/reb defenseIndex families** | Projection blind to steal/dreb | Map steals→assists, dreb→rebounds with sample gates — or leave holistic-only and document |
| **Football weather in prop MC** | Product decision | Only if calibrated; today MC ignores non-MLB by design |

### Explicitly out of scope / do not do

- Flip `NCAAF_GAME_LINE_SIM_VALIDATED`
- Publish / OTA / production freeze lift
- Invent positional defense splits or “healthy” from silence

---

## 7. Tests covering this pipeline

- `artifacts/stadium-mobile/lib/propContextPipeline.test.ts` — indices, weather, traces, double-count guard, injury honesty, sync timing  
- `artifacts/api-server/test/propContextInjuryHonesty.test.ts` — vacancy unknown ≠ OUT/healthy  
- `artifacts/stadium-mobile/lib/footballRushDefense.test.ts` — multi-sport tilts / NHL blocks  
- `artifacts/stadium-mobile/lib/footballWeatherHolistic.test.ts` — NFL outdoor/dome holistic weather  

---

## 8. College / NCAAF interaction (unchanged)

Bare asks like `8 leg college` parse as `gameLinesOnly` + NCAAF lock and exit under `NCAAF_GAME_LINE_SIM_VALIDATED=false` before slate sims. Prop-context wiring above applies to **eligible** prop paths (and NFL game-line holistic/context), not to P0-blocked NCAAF team markets. See `COACH_8_LEG_COLLEGE_AUDIT.md`.

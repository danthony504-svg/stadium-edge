# NCAAF AI Coach — matchup & injury intelligence audit

**Mode:** report only — no code, cap, P0, correlation, or Simulator V2 changes.  
**Domain:** `stadium-edge.onrender.com`  
**Generated:** 2026-10-09T02:01Z  
**Examples:** Iowa Hawkeyes @ Washington Huskies · Sacramento State Hornets @ Bowling Green Falcons

---

## Executive findings

1. **Rush/pass yards-allowed matchups are real and do adjust prop sim hits** (post-MC tilt ±~5pp) when Coach loads flattened defense packs — not explanation-only.
2. **O-line / pressure / sacks exist in the ESPN team-defense payload** but only affect sim when `loadFootballOppRushDefense` flattens them into `FootballOppDefenseSlice` (sacks, sacksAllowed, gamesPlayed). Nested raw fields alone are not used.
3. **Injuries for these four teams are unknown** — NCAAF injury feed returned **3 teams** (Florida, Rice, Virginia), each with **0 players**. Missing ≠ healthy in the rubric (`scoreInjury(null)`), but UI can still show “OK / not on report.”
4. **No depth chart / starting-QB feed** for NCAAF (or NFL). Cannot confirm starters from app data.
5. **P0 blocks NCAAF (and NFL) FG game totals + team/period totals** from unvalidated `nfl-drive` V1 scoring. Props/spreads/ML unaffected.
6. **Pace is basketball-only.** Football “tempo” is static coach soft-tilt; **IOWA / WASH / SAC / BGSU have no coach profiles** → tilt 0.
7. **Home-field** enters via venue splits in matchup-history + `isHome` home/away series blend in prop MC — not a fixed HFA points add in `nfl-drive`.
8. **Sac State @ BGSU** has weather **missing** from `/weather/parks` (not in 16-park catalog) and only **13 anytime-TD** props — skill matchup tilts mostly unused on that board.

---

## 1–2. Matchup inputs: source, freshness, values, sim use

| Input | Source | Freshness | Iowa @ WASH (actual) | Sac @ BGSU (actual) | Used in simulation? |
|-------|--------|-----------|----------------------|---------------------|---------------------|
| Rush yards allowed / g | ESPN box scores last ≤5 via `GET /sports/team-defense` → `rushDefense` | On fetch (no provider quote ts) | Iowa D **102.2** (2.89 YPC, n=5); WASH D **111.4** (3.20 YPC, n=5) | Sac D **150** (4.46, n=5); BGSU D **231.4** (6.09, n=5) | **Yes** — `footballRushDefenseTilt` → `adjustSimHitForOppDefenseTilt` in `pickScoreContext.ts` |
| Pass yards allowed / g | same | On fetch | Iowa **186.4** n=5; WASH **192** n=5 | Sac **196.4**; BGSU **176** | **Yes** — same tilt path for pass/recv markets |
| Points for / against | ESPN season avgs on team-defense + L10 matchup-history | On fetch | Iowa 29 / 12.6; WASH 26.6 / 18.4 (L10) | Sac 17.6 / 28.6; BGSU 11.4 / 33 | Partial — team-total lean / narrative; **FG totals P0-blocked** from drive sim grades |
| Defensive sacks / INT / PD / stuffs | ESPN `defensive.*` on team-defense | On fetch | Iowa: 13 sacks, 4 INT, 22 PD, 41 stuffs (5 gp); WASH: 10 / 7 / 18 / 56 | Sac: 7 / 0 / 12 / 31; BGSU: 15 / 2 / 7 / 36 | **Yes when flattened** into pack (`footballOppDefenseContext.ts`); feeds pressure / sack / INT tilts |
| O-line sacks allowed | ESPN `offensive.sacks` (= sacks taken) | On fetch | Iowa OL **5**; WASH OL **15** (5 gp) | Sac **7**; BGSU **7** | **Yes** as `sacksAllowed` for sack/pressure/pass tilts |
| Own rush YPC / pass YPG | ESPN offensive | On fetch | Iowa 5.9 YPC, 210.6 pass YPG; WASH 3.7 / 271.4 | Sac 3.7 / 216.2; BGSU 2.7 / 173.8 | Soft ownPack inputs for INT/QB-rush/pressure — **not** EPA |
| EPA / success rate / true O-line grades | — | — | **Missing** | **Missing** | **Not used** (does not exist) |
| Pace | StatMuse pace on matchup-history | — | **null** (football) | **null** | **No** for NCAAF/NFL (NBA/WNBA only in MC) |
| Recent opponents / L10 | `GET /sports/matchup-history` | On fetch | WASH L10 3-2 +8.2; Iowa L10 4-1 +16.4 | Both L10 1-4 (BGSU −21.6; Sac −11) | Form/matchup subscores + ML lean inputs; **not** drive-sim injuries |
| H2H / last meeting | matchup-history | On fetch | **Empty / null** | **Empty / null** | Null → no H2H adjustment |
| Home splits | matchup-history `homeSplit` / `awaySplit` | On fetch | WASH home 3-1 +11.3 (4g); Iowa away 1-0 +1 (1g) | BGSU home 0-2 −7.5; Sac away 0-2 −28.5 | Venue form / `mlLean`; prop MC blends home/away series when `isHome` set |
| Coach tempo / fav lean | Static `NCAAF_COACHES` (~22 teams) | Static | **IOWA & WASH not in table** → null | **SAC & BGSU not in table** → null | Soft composite ±0.4 only when resolved; **0 here** |
| Weather | `GET /weather/parks?sport=ncaaf` | Live OpenWeather-style | Husky Stadium **Neutral**, 62°F, wind 6 mph | **Not in 16-park catalog** | Holistic weather factor for football props when present; **MC mean weather is MLB-only** |

### Example tilt → sim-hit deltas (correct pack wiring)

| Pick context | Tilt | Display | Example simHit 0.55 → |
|--------------|-----:|---------|------------------------|
| Iowa rush **Over** vs WASH D | −0.15 | WASH 111.4 rush yds/g, 3.2 YPC, n=5 | **0.541** |
| WASH pass **Over** vs Iowa D | −0.66 | Iowa 186.4 pass yds/g + sack pressure bits | **0.510** |
| Sac rush **Over** vs BGSU D | **+0.45** | BGSU 231.4 rush yds/g, 6.09 YPC (leaky) | **0.577** |
| BGSU pass Over vs Sac D | −0.27 | Sac 196.4 pass yds/g | **0.534** |

Files: `footballRushDefense.ts`, `footballOppDefenseContext.ts`, `pickScoreContext.ts` (`adjustSimHitForOppDefenseTilt`), `api-server/.../defense.ts`, `rushDefenseAllowed.ts`.

---

## 3. Injuries / availability / depth / QB

| Check | Iowa | WASH | Sac State | BGSU |
|-------|------|------|-----------|------|
| On ESPN injury feed | **No** | **No** | **No** | **No** |
| Status classification | `unknown_no_team_report` | same | same | same |
| Confirmed unavailable starters | **Cannot confirm** | same | same | same |
| Confirmed healthy | **Must not assume** | same | same | same |
| Depth chart / starting QB | **No feed** | same | same | same |

**Global NCAAF injury feed this window:** 3 team rows (Florida, Rice, Virginia), **0 injury entries each** — effectively empty for the Coach slate.

Honesty rules in code (`injuries.ts`, `pickScore.ts`):

- `findPlayerInjury` → `none` | `ambiguous` | `found` (ambiguous fail-closed).
- Rubric: `scoreInjury(null)` → **omit** injury subscore (not “healthy”).
- MC: missing team weights → `0` adjustment (no shift), not a healthy claim.
- **UI caveat:** prop page can show “Not on the injury report → OK” when absent — **display only**.

Endpoint: `GET /sports/injuries?sport=ncaaf` → ESPN `football/college-football/injuries`.

---

## 4. Do injuries/matchups change sim / grade / edge / confidence?

| Path | Mutates numbers? | Notes |
|------|------------------|-------|
| Opp rush/pass defense tilt → sim hit | **Yes** | After MC; feeds simulation subscore / edge |
| Staging block Over vs stingy rush D | **Yes** | `shouldBlockRushOverVsDefense` |
| Coach soft tilt | **Yes** (±0.4 composite) when coach resolves — **not for these 4 teams** |
| Prop MC `oppKeyInjuries` / `ownKeyInjuries` | **Yes** on mean | `mean *= clamp(1 + 0.015*opp − 0.02*own, 0.88, 1.12)` |
| Injury rubric subscore | **Yes** when report present | **Null for these games** → no injury confidence component |
| Weather holistic factor | Soft score when park present | Iowa@WASH Neutral; Sac@BGSU missing |
| `nfl-drive` game totals | **No injury/O-line inputs**; grades **P0-blocked** for NCAAF/NFL FG & team/period totals | |
| Narrative cards (`propFactors`, coach notes) | Copy | |

---

## 5. Before / after — key starter unavailable (formula-level)

No confirmed named starter injury on ESPN for these games, so **no live athlete game-log before/after** was claimed.

Using the **real** `buildProjectionMean` injury weights (`api-server/src/lib/monteCarlo.ts`) with an illustrative 10-game rush sample (mean healthy **74.84**):

| Scenario | `ownKeyInjuries` | `oppKeyInjuries` | Mean | Δ vs healthy |
|----------|-----------------:|-----------------:|-----:|-------------:|
| Baseline (unknown/no weights) | 0 | 0 | **74.84** | — |
| Own key starter out (QB-scale weight 3) | 3 | 0 | **70.35** | **−6.0%** |
| Opp key injuries weight 3 | 0 | 3 | **78.21** | **+4.5%** |

Formula: `mean *= clamp(1 + oppInj*0.015 - ownInj*0.02, 0.88, 1.12)`.

**If a confirmed Iowa/WASH/Sac/BGSU key starter appeared on ESPN**, Coach would: (1) shift MC mean as above when weights wire into `simulate.ts`, (2) add injury rubric favor, (3) possibly change grade/edge/confidence. **Today those weights are 0 for all four teams** because they are absent from the injury feed.

---

## 6. Status taxonomy (enforced)

| Label | Meaning in Coach scoring |
|-------|---------------------------|
| Confirmed unavailable / elevated | On ESPN report with severity > 0 |
| Confirmed available-ish | ESPN status probable/active/available → severity 0 |
| Unknown | Not on report / team missing / fetch fail → **no healthy assumption** in rubric |
| Ambiguous | Duplicate name match → fail closed |

---

## 7. P0 — unvalidated V1 football totals

`coachP0UnvalidatedTotals.ts`:

- Sports: **nfl, ncaaf, nhl**
- Blocked from sim-derived grades: **team totals**, **period game totals**, **FG game totals**
- Reason: `unvalidated_period_or_team_total_calibration` (`nfl-drive` shared by NCAAF)
- **Props, spreads, moneylines not blocked**

Live check: `ncaafFgTotalBlocked=true`, `ncaafTeamTotalBlocked=true`, `ncaafPropNotBlocked=false` (prop correctly not flagged).

---

## 8. Missing fields → which picks would change

| Missing input | Iowa @ WASH impact | Sac @ BGSU impact |
|---------------|--------------------|-------------------|
| Team injury reports | All skill/TD props: injury subscore null; MC injury weight 0. **Would move** if QB/OL/skill confirmed out | Same; board is mostly anytime TD — injury would matter more for TD overs |
| Starting QB / depth | Cannot gate “backup QB” scripts | Same |
| Coach profiles (IOWA/WASH/SAC/BGSU) | Soft tilt stuck at 0 | Same |
| Weather park (Sac@BGSU) | OK (Neutral @ Husky Stadium) | Weather factor absent |
| H2H / last meeting | No H2H adjustment | Same |
| EPA / true O-line grades | Not modeled | Not modeled |
| Pace | N/A football | N/A |
| Pass YPA allowed | null in pack (pass tilt uses yds/g + sacks) | same |

**Posted markets:** Iowa@WASH **236** props (rush/pass/rec/TD/attempts). Sac@BGSU **13** anytime TD only — rush/pass matchup tilts have almost no seats to apply.

---

## 9. NFL / other sports parity

| Area | NFL | NCAAF | Other |
|------|-----|-------|-------|
| Team-defense + box yards | Same code path | Same | Sport-specific packs |
| Injury endpoint + severity (QB weight 3) | Same | Same | MLB/NBA different |
| Depth / starters | **None** | **None** | MLB probable pitchers exist |
| P0 totals block | Yes | Yes | NHL yes; NBA no |
| Pace in MC | No | No | NBA/WNBA yes |
| Coach soft tilt | Larger NFL table | ~22 teams; **not these four** | N/A |
| Weather parks | NFL catalog | 16 NCAAF parks (major only) | MLB parks |

---

## Key files

| File | Role |
|------|------|
| `lib/coach/buildParlay.ts` | Loads injuries, opp defense, weather, coaches, matchup history |
| `lib/footballOppDefenseContext.ts` | Flattens team-defense → sim packs |
| `lib/footballRushDefense.ts` | Tilt / pressure / block Over / sim-hit adjust |
| `lib/footballCoachTendencies.ts` | Soft coach tilt (sparse NCAAF) |
| `lib/footballScanContext.ts` | Weather + coaches for scan |
| `lib/injuries.ts` | Lookup, severity, game reports |
| `lib/pickScoreContext.ts` | Rubric + sim-hit matchup adjust |
| `lib/coachP0UnvalidatedTotals.ts` | V1 totals fail-closed |
| `lib/teamTotalMatchup.ts` | Team-total offense/D lean |
| `api-server/src/routes/defense.ts` | `/sports/team-defense` |
| `api-server/src/lib/rushDefenseAllowed.ts` | Box-score yards allowed |
| `api-server/src/routes/injuries.ts` | `/sports/injuries` |
| `api-server/src/routes/history.ts` | `/sports/matchup-history` |
| `api-server/src/lib/monteCarlo.ts` | Prop mean injury/home/pace |
| `api-server/src/lib/sportSim/nflDriveSim.ts` | Shared NFL/NCAAF scoring engine (P0-blocked for totals grades) |
| `api-server/src/lib/sportSim/registry.ts` | `ncaaf` → `nfl-drive` |

Raw probe: `/tmp/ncaaf-matchup-audit.json`

---

## Bottom line

For **Iowa @ Washington**, Coach has **usable rush/pass defense samples and weather**, and those **do move prop sim hits** when wired through `loadFootballOppRushDefense`. **Injuries, coaches, H2H, and depth are missing** — injury is correctly **unknown**, not healthy, in scoring.

For **Sacramento State @ Bowling Green**, BGSU’s **leaky rush D (231.4 yds/g)** would strongly tilt rush Overs **if** rush props were posted; the live board is **anytime-TD-only**, weather park is **absent**, and injuries/coaches are **missing**.

No merge / deploy / OTA from this audit.

# Audit: Bo Nix Under 13.5 Rush Yds @ −108 → displayed 98% hit

**Code tip verified:** `42a9ace9729572491823d8240fef8e6f978c4522`  
**History snapshot:** 2026-10-15 ESPN gamelog athlete `4426338`  
**No OTA / deploy** — findings only; quality gates unchanged.

**Label:** The **98% display is an uncalibrated model estimate** from **n=5** recent games (soft-clip / opp-tilt ceiling). It is **not** a calibrated win probability and is **not** tuned toward −108 (~51.9% implied). Keep the calculation reproduction below for audit; treat the gap vs book as **diagnostic disagreement**, not proven model error.

---

## 1. Identity

| Field | Value |
|-------|--------|
| Athlete | ESPN **`4426338`** — Bo Nix |
| Team | DEN **`7`** |
| Event | **`401872995`** — Seattle Seahawks @ Denver Broncos |
| Kickoff | 2026-10-16T00:15Z (Week 6) |
| Opponent | SEA **`26`** |
| Market | `player_rush_yds` |
| Side / line | **Under 13.5** |
| Book | **−108** → implied ≈ **51.92%** |

---

## 2. Actual `rushingYards` history (missing ≠ 0)

ESPN gamelog `names` maps index 12 → `rushingYards` (not ambiguous label `YDS`, which also appears for passing).

| Date | Opp | CAR | **rushingYards** |
|------|-----|----:|-----------------:|
| 2026-10-11 | LAC | 4 | **10** |
| 2026-10-04 | SF | 2 | **10** |
| 2026-09-28 | LAR | 4 | **7** |
| 2026-09-20 | JAX | 5 | **6** |
| 2026-09-15 | KC | 3 | **2** |

- Sample size **5** (all mapped; no blanks).
- Blank/missing would be **skipped** via `num()` / `statSeries` — **not** coerced to 0 (`Number("") === 0` is explicitly avoided).
- Genuine ESPN `"0"` would count as zero; none appear here.
- Games under 13.5: **5 / 5**.

---

## 3. Final distribution parameters + exact hit count

| Parameter | Exact value |
|-----------|-------------|
| Family | Continuous **Normal** (`player_rush_yds` not discrete) |
| Sample size | **n = 5** (`rushingYards` = `[10, 10, 7, 6, 2]`) |
| Projection mean | `0.4×L5 + 0.3×L10 + 0.3×season` = **7.0** yd |
| Historical sample SD | **≈ 3.3166247903554** |
| Used SD | `max(sampleStd, mean×0.12, 0.35)` = **3.3166247903554** |
| Simulations | **10,000** (audit seed `20261015`) |
| Draw | `max(0, Normal(7.0, 3.3166247903554))` |
| Under rule | `sample < 13.5` (pushes lose; Over uses `>`) |

| Side | Exact hit count / 10,000 | Rate |
|------|-------------------------:|-----:|
| **Under 13.5** | **9705** | **0.9705** (display round3 → 0.971) |
| Over 13.5 | **295** | 0.0295 |
| Push (`=== 13.5`) | **0** | 0 |

Under + Over = 1.0 → **not inverted**.

**Displayed 98% path (uncalibrated, n=5):** props-only 5/5 → soft-clip **0.98**, and/or MC 0.9705 + one SEA Under tilt → soft-cap **0.98**.

Shared distribution also scores alt lines on the **same** samples:

| Line | Under | Over |
|-----:|------:|-----:|
| 9.5 | 0.769 | 0.231 |
| 11.5 | 0.905 | 0.095 |
| **13.5** | **0.971** | **0.030** |
| 15.5 | 0.995 | 0.005 |
| 17.5 | 1.000 | 0.000 |

---

## 4. Opponent adjustment (SEA rush D) — once only

Live SEA box-score rush yards allowed (last 5 finals): **100.4 yds/g** (n=5) → soft-stingy band (≤105).  
Own rush YPC from Nix CAR/YDS: **~1.94**.

| Step | Under hit |
|------|----------:|
| Raw MC | **0.971** |
| After **one** `adjustSimHitForOppDefenseTilt` | **0.980** (soft ceiling) |
| After second adjust (wrong) | still **0.980** (ceiling) |

- Opp tilt is **post-sim hit-rate** (±5pp), **not** a change to Normal(mean, std).
- With `oppMatchupAppliedToSim`, Final AI `opponentTendency` is display-only — **no second composite lean**.
- Props-only empirical path: 5/5 under → `localHitFromHistory` soft-clips **1.0 → 0.98** before opp adj (same display).

**Displayed 98%** is therefore the soft-cap / empirical clip of an already near-certain Under — **not** book calibration and **not** Under inversion.

---

## 5. Cache identity / version

| Store | Key |
|-------|-----|
| Athlete history | `auth-hist:nfl:4426338` / `player-history:football/nfl:4426338:current` (30m) |
| Opp team-defense | `team-defense:football/nfl:26:v7` (60m) |
| Own team-defense | `team-defense:football/nfl:7:v7` (60m) |
| Prop sim distribution | shared key **without** line/side; fingerprint over recent series |
| Client teamDefense TTL | 60m (`COACH_CONTEXT_TTL_MS.teamDefense`) |

---

## 6. 3-of-10 shortfall funnel — do not blame correlation yet

| Status | Detail |
|--------|--------|
| Telegram / coach-events ingest for this device ask | **UNVERIFIED** (digest window showed 0 legitimate underfills; no row receipt confirmed for this `requestId`) |
| Attribution to correlation | **Blocked** until request-linked funnel counters are retained **and** coach-events receipt is confirmed |

Funnel stages (instrumentation semantics; Week 6 slate has 14 upcoming NFL games; rush alts supported):

`fetched → simulated → qualified → after_dedupe → after_correlation → delivered`

Manifest now carries `requestId` + `footballPropFunnelSummaryForRequest` on reliability `rootCause` so counters stay request-linked. **Until ingest is verified, treat shortfall cause as unknown — not “removed by correlation.”**

---

## 7. Checks preserved

- Qualification / cancellation / deadlines: unchanged  
- Missing ≠ favorable zero  
- Under not inverted  
- Matchup not double-counted into Final AI when applied to simHit  
- No OTA

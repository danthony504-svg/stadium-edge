# Audit: Bo Nix Under 13.5 Rush Yds @ −108 → displayed 98% hit

**Code tip verified:** `42a9ace9729572491823d8240fef8e6f978c4522`  
**History snapshot:** 2026-10-15 ESPN gamelog athlete `4426338`  
**No OTA / deploy** — findings only; quality gates unchanged.

This reproduces the **delivered** 98% from actual rushingYards + formulas. It does **not** tune toward −108.

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

## 3. Distribution parameters (MC, continuous Normal)

| Parameter | Value |
|-----------|--------|
| Family | Continuous **Normal** (`player_rush_yds` not discrete) |
| Projection mean | `0.4×L5 + 0.3×L10 + 0.3×season` = **7.0** yd |
| SD | `max(sampleStd, mean×0.12, 0.35)` ≈ **3.32** yd |
| Draw | `max(0, Normal(mean, std))` × **10,000** (seed `20261015` for audit) |
| Under hit rule | `count(sample < 13.5) / 10000` (pushes lose; Over uses `>`) |

**Exact Under hit count:** **9705 / 10000** → rounded **0.971**  
**Over on same draw:** **295 / 10000** → **0.030**  
Under + Over ≈ 1.001 → **not inverted**.

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

## 6. 3-of-10 shortfall funnel (reconstructed)

No device session manifest for this exact ticket was retained in-repo. Funnel stages and Week 6 constraints:

| Stage | NFL Week 6 (instrumentation semantics) |
|-------|----------------------------------------|
| Upcoming games considered | **14** scheduled (SEA@DEN … WSH@SF) — scoreboard week 6 |
| Supported rush alts | `player_rush_yds_alternate`, `player_rush_attempts_alternate`, `player_rush_longest_alternate` in `ALT_MARKETS` — within sim ladder budget (3 rungs/ladder, DST cap unchanged) |
| Candidates fetched | Full posted board for allowed markets (props expand + alts) |
| Simulated | Cap via `boardScanMaxPropsToSim` / football mix quotas — **no per-candidate defense fetch** |
| Qualified | Staging quality gates (sim grade, odds, `blockOver` where applicable) |
| Removed by correlation / dedupe | `after_dedupe` → gap to `final_selected` logged as correlation/ticket-mix rejects |
| Delivered | **3 / 10** reported shortfall — honest underfill when &lt;10 clear within deadline |

Nix Under 13.5 clears empirical/MC gates easily; shortfall is **ticket fill / correlation / mix**, not this leg’s sim identity.

---

## 7. Checks preserved

- Qualification / cancellation / deadlines: unchanged  
- Missing ≠ favorable zero  
- Under not inverted  
- Matchup not double-counted into Final AI when applied to simHit  
- No OTA

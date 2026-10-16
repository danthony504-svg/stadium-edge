# Audit: Jaxon Smith-Njigba Over 93.5 Rec Yds @ −111 → reported 92%

**Ask context:** device `8 leg broncos` on preview OTA `01a140e5-3c7a-70d1-8968-af35752d0c59`  
**API:** `ddeb4733348b98d7112748edc19c7e06fc6fc99a`  
**Athlete:** ESPN `4430878` (SEA WR)  
**Game:** Seattle Seahawks @ Denver Broncos (`401872995` / Odds `855f58fad5f0f14b239f4f63df27998b`)  
**Audited history snapshot:** 2026-10-15 via `/api/sports/player-history?sport=nfl&athleteId=4430878`

This explains the **reported 92% from actual scoring inputs and formulas**. It does **not** retune the model to match −111.

---

## 1. Provider identity → market → line

| Field | Value |
|-------|--------|
| Provider | The Odds API (`regions=us`, American odds) |
| Market key | `player_reception_yds` (+ optional `_alternate`) |
| Side / line | Over **93.5** |
| Book price (device) | **−111** |
| Athlete join | ESPN roster → `athleteId=4430878`, `playerTeamId=26` (SEA) |

Implied win probability at −111:

\[
p_{\text{book}} = \frac{111}{111+100} \approx 0.5261\ (52.61\%)
\]

Repo SEA@DEN fixtures historically used **Over 92.5**; the live board can post **93.5** on the same family. Same code path either way.

---

## 2. Receiving-yard history (units)

Source: ESPN gamelog via `loadAuthoritativePlayerHistory`.  
Stat mapping (`propStatValue.ts`):

- `player_reception_yds` → **`receivingYards` only** (yards)
- Must **not** use ambiguous display label `YDS` (collides with rush YDS)

Live recent series (5 games, most recent first):

| Date | Opp | receivingYards | targets | receptions | ambiguous `YDS` (rush) |
|------|-----|----------------|---------|------------|------------------------|
| 2026-10-11 | SF | **102** | 8 | 5 | 16 |
| 2026-10-04 | LAC | **76** | 6 | 5 | 0 |
| 2026-09-27 | WSH | **128** | 14 | 10 | 0 |
| 2026-09-20 | ARI | **155** | 11 | 9 | 0 |
| 2026-09-10 | NE | **122** | 11 | 8 | 0 |

If mapping wrongly used `YDS`, L5 would average ~3.2 and Over 93.5 would be near-zero — **that did not happen**. Mapping is on `receivingYards`.

**Vs DEN history:** empty (`vsOpponent: []`) — no soft vs-opp blend.  
**Away split:** 2 games / 141.5 avg — soft venue blend requires ≥3 games → **suppressed**.

---

## 3. Usage / injury inputs

| Input | Role for `rec_yds` |
|-------|--------------------|
| Opportunity Shift | Targets/routes vacancy → family `rec_yds` (efficiency weight 0.65); WR defaults 7 targets / 28 routes when usage missing |
| Venue / Matchup Shift | Combined into `combinedPreSimMult` ∈ [0.78, 1.35] |
| Key-injury tilt | `mean *= clamp(1 + oppInj×0.015 − ownInj×0.02, 0.88, 1.12)` |
| Minutes | NFL typically null (NBA/WNBA path) |

Live Opportunity/Venue fingerprints from the device session were not retained in repo logs; their effect is bounded by the caps above.

---

## 4. Distribution parameters

| Parameter | Value / rule |
|-----------|----------------|
| Family | Continuous **Normal** (`reception_yds` is not discrete) |
| Base mean | `0.4×L5 + 0.3×L10 + 0.3×season` = **116.6** yd (all windows = same 5 games) |
| SD | `max(sampleStd, mean×0.12, 0.35)` ≈ **29.56** yd |
| Draw | `max(0, Normal(mean, std))` × **10,000** |
| Over hit | `count(sample > 93.5) / 10000` (pushes lose) |

Cache identity (line/odds **excluded**):  
`simdist:{tier}:10000:{historyFingerprint}:{sport|player|market|athleteId|…|oppFingerprint}`

---

## 5. What “92%” is

Two different UI numbers:

| UI label | Source | Cap |
|----------|--------|-----|
| Simulation factor **`N% hit`** | `Math.round(simHit × 100)` | 0–100 |
| Confidence tile | Holistic factor blend (`confidenceFromHolisticFactors`) | **5–95** |
| **`N% input coverage`** (was “context grounded”) | `presentApplicable / applicableFactors` | coverage only — **not** accuracy |

**Best reading of device “92%” on this prop:** Simulation **`92% hit`** ⇒ `simHit ≈ 0.92`.

That is **not** book implied (52.6%) and not automatically the Confidence tile (fixture peers often show Confidence in the 60s–70s while sim hit is higher).

---

## 6. Explaining ~92% from inputs (no retune)

Base-only Monte Carlo (mean **116.6**, std **29.56**, Over 93.5, 10k draws, audit seed):

| Scenario | Approx `simHit` | Edge vs −111 (`simHit − 0.526`) |
|----------|-----------------|----------------------------------|
| Base mean only (no shifts) | **~0.77 (77%)** | ~+24.6 pp |
| Mean ≈ **135** (≈ **1.16×** base) | **~0.92 (92%)** | ~+39.4 pp |
| Mean 140 | ~0.94 | ~+41 pp |

So a reported **92% hit** is consistent with the live history **plus** a pre-sim multiplier near the middle of the allowed Opportunity×Venue×Matchup band (~**+16%** mean), **not** with inventing a new distribution or matching −111 by hand.

Derived book metrics **if** `simHit = 0.92` and price = −111:

- Edge ≈ **+39.4** percentage points (`simEdgeFromHit`)
- EV% ≈ `(0.92 × 1.9009 − 1) × 100 ≈ +74.9%` (decimal from −111)

Holistic **Confidence** remains a separate score (sim subscore ≈ `5.5 + (0.92−0.5)×9 ≈ 9.3` contributes, but missing factors pull Confidence down from 95).

---

## 7. Stat-family check for sibling SEA@DEN props

Correct ESPN machine fields (must not use ambiguous `YDS` / `TD` / `LNG`):

| Delivered market (typical broncos ticket) | Odds key | History field | Dist |
|-------------------------------------------|----------|---------------|------|
| Rec Yds | `player_reception_yds` | `receivingYards` | Normal |
| Receptions | `player_receptions` | `receptions` | Discrete |
| Rush Yds | `player_rush_yds` | `rushingYards` | Normal |
| Pass TDs | `player_pass_tds` | `passingTouchdowns` | Discrete |
| Longest Reception | `player_reception_longest` | `longReception` | Normal-ish continuous |

Isolated fixture `coach-pipeline-cancel-isolated.json` (same ask family) seated Rec Yds / Receptions / Rush Yds / Pass TDs on those labels — mapping table matches.

---

## 8. “100% input coverage” ≠ calibrated accuracy

`coveragePct = round(presentCount / applicableCount × 100)` over holistic factors that apply to the sport/market.

- **100%** means every applicable factor had a non-null score (form, matchup, simulation, etc.).
- It does **not** claim the 10k hit rate is calibrated to closing price.
- UI copy updated from “context grounded” → **“input coverage”** so the card cannot be read as accuracy.

---

## 9. Limits of this audit

- Live Odds props payload for event `855f58…` returned **0 rows** from this agent environment at audit time (history endpoint worked). Book identity for the exact −111 quote is taken from the device report.
- Exact Opportunity/Venue fingerprint from the device session was not persisted; the **1.16×** mean lift is the multiplier that reconciles base history with a **92% hit**, inside existing caps — not a proposed code change.

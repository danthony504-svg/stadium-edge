# ESPN period OD override — read-only validation

**PR:** #649 (`cursor/lean-preserve-qualified-def8`)  
**Scope:** Read-only. No code changes. No merge/OTA. No P0/qualification weakening. No Simulator V2.  
**Artifact:** `/tmp/validate-period-od-readonly.json` (12 games: 6 NFL + 6 NCAAF).

---

## 1. Trace: source → overwrite

| Step | Location | Behavior |
|------|----------|----------|
| ESPN schedule | `api-server/.../teamPeriodStats.ts` → `site.api.espn.com/.../teams/{id}/schedule` | Keep **completed / post** only; newest first; **≤10** games |
| ESPN scoreboard | Same file → `.../scoreboard?dates=YYYYMMDD` | Per-game **linescores[]** (period points); 24h cache |
| Aggregate | `periodAverages.q1…q4`, `h1=q1+q2`, `h2=q3+q4` | Mean scored & allowed; `sampleSize` = games with usable linescores |
| API surface | `GET /api/sports/team-period-stats?sport=&teamId=` | 2h server cache; sports: nfl, ncaaf, nba |
| Client fetch | `stadium-mobile/lib/api.ts` `fetchTeamPeriodStats` | Same endpoint; client TTL 2h (`coachContextCache`) |
| Team map | `resolveTeamIds` / slate eval labels | Home/away ESPN ids for the odds game label |
| Blend (OD) | `buildPeriodOffenseDefenseProfile` | `home[p] = mean(home.scored[p], away.allowed[p])`; `away[p] = mean(away.scored[p], home.allowed[p])` |
| Share | `periodScoresForDraw` + `fgExpectedFromPeriodAverages` | `periodScore ≈ fgDraw × (periodExpected / fgExpected) × noise(±7%)` |
| Overwrite | `applyPeriodOffenseDefenseCoverRates` in `coachGameMonteCarlo.ts` | Re-derive **period** `coverHitRates` only; FG rates untouched |

**Affected files (read path):**  
`artifacts/api-server/src/routes/teamPeriodStats.ts`  
`artifacts/stadium-mobile/lib/api.ts`  
`artifacts/stadium-mobile/lib/gameSimScoring.ts` (`blendPeriodExpected`, `buildPeriodOffenseDefenseProfile`, `deriveCoverHitRatesFromOutcomes`, `coverQueryHits`)  
`artifacts/stadium-mobile/lib/gamePeriodScoring.ts` (`periodScoresForDraw`)  
`artifacts/stadium-mobile/lib/coachGameMonteCarlo.ts` (`applyPeriodOffenseDefenseCoverRates`, slate + picks fetch)

---

## 2. What OD is — and why Bucs Q2 +3.5 rises ~8–9pp

**OD = Offense/Defense period form blend**, not a Vegas “odds” feed.

For each period \(p\):

\[
\mathbb{E}_{\text{home}}[p] = \tfrac{1}{2}\big(\text{home.scored}[p] + \text{away.allowed}[p]\big)
\]
\[
\mathbb{E}_{\text{away}}[p] = \tfrac{1}{2}\big(\text{away.scored}[p] + \text{home.allowed}[p]\big)
\]

Then each FG Monte Carlo draw is scaled by a **stable share**:

\[
\text{share}_{\text{side}}[p] = \mathbb{E}_{\text{side}}[p] \big/ \sum_{q\in\{q1..q4\}} \mathbb{E}_{\text{side}}[q]
\]

**Frac-only baseline** uses fixed NFL shares (`q2 = 0.24` both teams).  
**OD** replaces those with team-matchup shares from ESPN linescores.

### TB @ DAL (live)

| | Home (DAL) | Away (TB) |
|--|----------:|----------:|
| Q2 scored / allowed (L4) | 5.0 / 8.3 | 5.0 / 7.5 |
| Blended Q2 expected | **6.3** | **6.7** |
| FG from period avgs | 27.4 | 23.6 |
| **Q2 share** | **0.230** | **0.284** |

Away share − home share = **+0.054**. On the same 10k FG draws:

| Path | Bucs Q2 +3.5 |
|------|-------------:|
| Frac-only | 0.870 |
| Period OD | **0.953** |
| Δ | **+8.3pp** |

Mechanically: OD gives Tampa a larger slice of each FG draw in Q2 than Dallas, so `away + 3.5 > home` hits more often. The opposite dog (Cowboys Q2 +3.5) falls **−24.7pp** (0.847 → 0.600) on the same game — zero-sum side shift, not a global “everything hits more” inflate.

---

## 3. Historical vs predictive; teams/period; leakage

| Check | Result |
|-------|--------|
| Data type | **Historical** trailing linescores (completed games only) |
| Predictive use | Used as **form prior** for period shares — not market prices, not projections from a trained model |
| Correct teams | ESPN `teamId` matched to home/away competitors on each past event; blend uses **opponent’s allowed** for this matchup |
| Correct period | `linescores[i]` → `q{i+1}`; `h1/h2` summed from quarters |
| Future leakage | **None observed** — schedule filter is `completed \|\| state===post`. TB@DAL (Scheduled) is not in TB’s or DAL’s L4 sample (both `sampleSize: 4` = prior weeks only) |
| Sample size | Early season: NFL games in probe all **n=4/4**; NCAAF **4–6** |

---

## 4. Orientation, settlement, Q/H, sampling

| Property | Evidence |
|----------|----------|
| Home/away orientation | Swap home/away averages → expectations swap. **0 orientation failures / 12 games** |
| Q2 settlement | `period:q2`, `teamSide` away/home, cover `score + line > opp` — same definition on frac and OD |
| Q1/Q2/1H/2H | API `h1 = q1+q2`, `h2 = q3+q4`. Client share check: `h1 share ≈ q1+q2 shares` within rounding. **0 Q/H consistency failures** |
| FG control | Away FG +3.5 Δ(OD−frac) = **0 on all 12 games** (overwrite is period-only) |
| Valid probabilities | Marginal rates in (0,1); however **cross-query complementarity is weak under OD** (below) |
| Simulation sampling | FG draws: one 10k set per game. Period noise: `Math.random() ±7%` **inside `periodScoresForDraw`, re-rolled per query per draw** — independent noise across markets on the same FG draw. Same-team +3.5/−3.5 OD sums can reach **1.3–1.7** (frac sums stayed ~1.02). **No fixed seed** — rates not bit-reproducible |

Also: FG MC projected totals ~**84** while period-average FG sums ~**41–57**. Shares are applied to an inflated FG scale — period point levels are not calibrated to market totals (~48).

---

## 5. Multi-game NFL / NCAAF (frac vs OD)

**72** period/FG market comparisons across **12** games.

| Aggregate | Value |
|-----------|------:|
| Mean Δ (OD − frac) | **−2.8pp** |
| Mean \|Δ\| | **18.3pp** |
| Share with \|Δ\| ≥ 5pp | **69.4%** |
| NFL mean \|Δ\| | 19.4pp |
| NCAAF mean \|Δ\| | 17.1pp |

### Away Q2 +3.5 (illustrative)

| Game | n | Frac | OD | Δpp |
|------|--:|-----:|---:|----:|
| TB @ DAL | 4/4 | 0.870 | **0.953** | **+8.3** |
| PHI @ JAX | 4/4 | 0.868 | 0.968 | +10.0 |
| HOU @ TEN | 4/4 | 0.867 | 0.980 | +11.3 |
| LV @ NE | 4/4 | 0.870 | 0.949 | +7.9 |
| CIN @ MIA | 4/4 | 0.870 | 0.906 | +3.6 |
| CHI @ GB | 4/4 | 0.867 | **0.281** | **−58.6** |
| NCAAF extremes | 4–6 | — | — | **−59.9 … +11.4** |

OD is a **large, sample-sensitive side shifter**, not a small refinement. With n≈4 it can move a −110 Q2 dog by **tens of points**.

---

## 6. Calibration vs historical outcomes

| Evidence type | Available? |
|---------------|------------|
| In-repo period-spread outcome backtest | **No** |
| Closing-line / Brier / log-loss for Q2 spreads | **No** |
| Sample sizes | **Yes** — reported above (mostly 4) |
| Market-implied check | Not run as a formal calibration (would need closing Q2 prices + results) |

**Cannot claim OD is better-calibrated than frac-only.** What we can say: OD changes rates a lot; errors are unmeasured; small-n variance dominates.

---

## 7. Can 0.954 be reproduced?

| Quantity | Value |
|----------|------:|
| This probe OD (TB away Q2 +3.5) | **0.953** |
| OD recompute band (7×, same FG draws) | **0.951–0.953** (mean 0.9516) |
| Ticket claim | **0.954** |
| In noise band (±0.01)? | **Yes** |

There is **no stored simulation seed**. Exact equality to 0.954 requires the original `Math.random` period-noise sequence. Functionally, **0.954 is the production OD path**, not the frac-only path.

---

## 8. Recommendation

### Root cause (confirmed)
Ticket 0.954 comes from the **ESPN period OD share overwrite** on board-scan sims. Frac-only (~0.86) is the server default before that overwrite. Settlement/period/side are correct; the lift is asymmetric Q2 shares (away 0.284 vs home 0.230) on small historical samples.

### Retain / correct / disable?

| Option | Verdict |
|--------|---------|
| **Retain as-is** | **Not recommended** for release confidence on period-spread tickets. Multi-game \|Δ\|≈18pp with n=4, no outcome calibration, FG scale mismatch (~84 vs ~50), and per-query period noise breaking cross-market consistency. |
| **Disable** | Acceptable **interim** if period spreads must not drive fill seats until fixed (frac-only or hard-exclude period GLs from fill). |
| **Correct (preferred)** | Fix before trusting OD-driven Q2 grades: (1) shared period-noise per draw across queries; (2) minimum sample / shrink shares toward 0.24; (3) reconcile FG MC scale with period averages or market totals; (4) add outcome calibration metrics. |

### PR #649 release

- **Post-lean fill / correlation / P0:** not the OD root cause; prior fill findings still hold.  
- **Do not merge/OTA #649** while seat 5’s ~95% Q2 grade depends on uncorrected OD under early-season n=4 — unless product explicitly accepts that pre-existing grading risk.  
- **No code changes in this validation pass** (per instructions).

---

## Evidence summary

- Pipeline traced end-to-end; leakage guard OK; orientation OK; Q/H OK; FG control Δ=0.  
- Bucs Q2 +3.5: frac 0.870 → OD **0.953** (+8.3pp); claim 0.954 in OD noise band.  
- 12-game panel: mean \|Δ\| **18.3pp**, 69% ≥5pp; extremes ±60pp.  
- Calibration vs results: **unavailable**.  
- Recommendation: **correct OD (or disable for small-n)** — do not retain unchanged for high-confidence period-spread release.

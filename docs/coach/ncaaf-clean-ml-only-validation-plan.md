# Moneyline-only validation plan — clean E1 α=1.15

**Status:** **PLAN ONLY** — no retrieval, no spend, no FINAL_EVAL build this turn  
**Candidate:** frozen clean E1 **α=1.15** ([`ncaaf-clean-e1-freeze.md`](./ncaaf-clean-e1-freeze.md))  
**ATS:** tuning **stopped**; S2 remains a **separate** market gate (failure blocks spreads, not ML by automatic coupling)  
**Rule:** Do **not** weaken M1–M4 / C1–C6 / E4 / P2. Do **not** treat TUNING M3 as FINAL_EVAL PASS.  
**Ops:** NCAAF blocked · production freeze · voice paused · no deploy/OTA/unlock · `ODDS_API_KEY` unset here

---

## 0. Market separation (locked product rule)

| Market | Gate family | If fail |
|--------|-------------|---------|
| Moneyline | M1–M4 + Coach CLV C1–C6 + E4 + P1–P3 | ML stays blocked / research-only |
| Spreads / ATS | S1–S4 (S2 vs coin) | **Spreads** stay blocked — does **not** auto-fail ML |
| Totals / ALTs | Own data gates | Independent `INSUFFICIENT_DATA` |

P3: *No market enabled solely because another passes.* ML validation may proceed on its own evidence path while S2 remains fail/open.

---

## 1. Evidence taxonomy

| Class | Meaning | Action |
|-------|---------|--------|
| **Missing evidence** | Required archive / fixture / join does not exist yet | Retrieval or free ESPN build **when authorized**; until then criterion = unmet / unscored |
| **Failed evidence** | Measured against locked threshold and did **not** pass | Do not weaken threshold; remediate process or accept FAIL |
| **Screen-only** | TUNING identical-334 / w1–7 number | May guide research; **never** final acceptance |

---

## 2. Unmet ML-related criteria (inventory)

### 2a. Engine moneyline (FINAL_EVAL acceptance)

| # | Criterion (locked) | Threshold | Current status | Evidence class | Exact data needed | Existing cache coverage | Retrieval cost (est.) |
|---|-------------------|-----------|----------------|----------------|-------------------|-------------------------|------------------------|
| **M1** | Sample | `n ≥ 200` decided games with close ML on **FINAL_EVAL** | **Unmet** — FINAL_EVAL fixtures **not built** | **Missing** | ESPN finals for 2025 w8+ (+ completed 2026 RS) joined to Odds close `h2h` (home+away American) with `closeSnapshotTimestamp ≤ commence` | FINAL_EVAL games/closes: **0 files** in fixtures. Count-only probe historically ~416 (2025 w8–15) + ~455 (2026 completed) — **not vendored** | **ESPN games: $0**. Odds close `h2h` only: ~156 buckets × 10 credits ≈ **~1 560** base (+25% buffer → **~2 000** cap) for 2025 w8–15; +2026 similar **~1 700–2 200**. `h2h,spreads` doubles (~**3 120** / ~**3 400**). **Not authorized this turn** |
| **M2** | vs coin | `brierEngine < 0.25` | TUNING screen (E1 α=1.15 identical-334): **~0.197** (screen true) · FINAL_EVAL: **unscored** | Screen-only / **Missing** on FINAL_EVAL | Same FINAL_EVAL close-joined ML labels + frozen E1 predictions (eval-only closes) | TUNING closes present (`ncaaf-tuning-2025-w1-7-closing-lines.json`, 424/470 with `closeMlHome`) — **screen only** | Included in M1 pull when authorized |
| **M3** | vs market | `brierEngine ≤ brierMarketClose + 0.02` | TUNING screen Δ≈**0.0188** (screen true) · **≠ final pass** · FINAL_EVAL: **unscored** | Screen-only / **Missing** on FINAL_EVAL | FINAL_EVAL `closeMlHome` (+ away for audit) · **no** closes in features | TUNING archive only | Same as M1 — **do not** re-pull TUNING |
| **M4** | Bias | `\|meanP − meanY\| ≤ 0.08` | TUNING screen bias≈**−0.066** (screen true) · FINAL_EVAL: **unscored** | Screen-only / **Missing** on FINAL_EVAL | Same as M2/M3 | TUNING only | Same as M1 |

**Explicit:** TUNING M3 true under E1 α=1.15 is **screening**. It does **not** unlock FINAL_EVAL, gate flip, or product ML.

### 2b. Coach selection / ML CLV (locked C1–C6 + R1–R4)

| # | Criterion | Threshold | Current status | Evidence class | Exact data needed | Existing cache coverage | Retrieval cost (est.) |
|---|-----------|-----------|----------------|----------------|-------------------|-------------------------|------------------------|
| **C1** | Sample | `nMlWithClv ≥ 50` | Phase-e remeasure: **n=15** → **FAIL**; clean E1: **not measured** | **Failed** (phase-e) + **Missing** (clean E1 / early cache) | Two-sided early ML (~T−24h) with real away American odds; selection timestamp; same-side close ML | `ncaaf-phase-e-selection-prices.json`: **705** home-only early rows (no away ML). `/opt/cursor/artifacts/ncaaf-e2b-early-snapshots`: **empty**. `earlyCachePicks=0` on last CLV report | Historical early snaps ≈ **same order as close pull** for the eval window (TUNING-scale ~**3.5k–4.5k** credits if `h2h`+region; FINAL_EVAL window separate). **Paid — not authorized** |
| **C2** | Mean ML CLV | `meanClvProbPoints ≥ 0` | Phase-e: **−0.00404** → **FAIL** (no negative floor) | **Failed** | Same as C1 on clean E1 stamp after R1–R4 | Prior fail stands until remade on clean E1 + real early cache | Included in early-snap pull |
| **C3** | Beat-close rate | `≥ 0.45` | Phase-e: **0.40** → **FAIL** | **Failed** | Same | Same | Same |
| **C4** | Side mix | home≥20 and away≥20 | Phase-e funnel 52/36 → screen pass; needs real away prices under R2 | **Missing** away early prices for clean path | Away ML from `odds-early-cache` only (R2) | Fixture cannot supply away (R1) | Early-snap pull |
| **C5** | Soft gates | PASS_SOFT_GATES_ONLY or better on **same** engine | Phase-e soft gates pass on drive stamp — **not** remeasured on clean E1 | **Missing** on clean E1 | Close-archive soft-gate remeasure under `ncaaf-score-margin-v1-research` + α=1.15 | Phase-e closes 842 present (2023–24 holdout) — wrong stamp for clean claim | Usually **$0** if using existing phase-e closes for soft gates **or** FINAL_EVAL closes once built |
| **C6** | Label | Only then `E2b_coachPickClv=PASS` | Last label: `COMPUTED_NO_PASS_LABEL` / fail criteria | **Failed** label | C1–C5 all true on clean E1 | — | — |

### 2c. Injury validation (E4) — ML product dependency

| Requirement | Threshold / rule | Current status | Evidence class | Exact data needed | Existing cache coverage | Retrieval cost |
|-------------|------------------|----------------|----------------|-------------------|-------------------------|----------------|
| Pregame freeze | `captureTimestamp < kickoffIso` | **Unmet** for TUNING / FINAL_EVAL historical | **Missing** | Multiple pre-kick snapshots per game; join `injuryKnown=true\|null`, optional `qbOut`; **never** null→false | TUNING closes: injuryKnown/qbOut **0/470** non-null. Phase-e closes: **842/842 null**. Forward ESPN snaps under `ncaaf-pregame-injury-snapshots/` (live only; **must not** backfill past games) | Historical backfill: **no verified free source**. Paid providers (SportsDataIO / ScoreTape) **timing unproven / not configured** — **do not purchase** until timing evidence reviewed ([`ncaaf-e4-injury-provider.md`](./ncaaf-e4-injury-provider.md)). Forward collector: **$0** ESPN for **future** slates only |
| Segment conservatism | mean \|edge\| on `injuryKnown=null` ≤ mean \|edge\| on `true` | **Unscored** | **Missing** | Known vs unknown segments with documented n | — | After joins exist |
| E4 completion | Required before gate flip (with E6) | **OPEN / INSUFFICIENT_DATA** | **Missing** | Above | — | — |

### 2d. Product / process (always in force)

| # | Criterion | Status | Class |
|---|-----------|--------|-------|
| **P1** | Live stamp stays `ppg-per-drive-v1`; research opt-in only | Met by policy | — |
| **P2** | `NCAAF_GAME_LINE_SIM_VALIDATED=false` until human E6 | Met (blocked) | Policy hold |
| **P3** | No market enabled solely because another passes | Met by this ML-only plan | — |

### 2e. Explicitly out of ML-only scope (do not block ML *scoring*, do block product enablement of those markets)

| Item | Status | Note |
|------|--------|------|
| S2 ATS | **Failed** on TUNING (Brier≈0.260) | Blocks **spreads**, not ML acceptance path |
| Totals / ALTs | **Missing** closes | `INSUFFICIENT_DATA` — separate |

---

## 3. What TUNING already proved (screen-only — not final)

| Metric | E1 α=1.15 identical-334 | Use |
|--------|-------------------------|-----|
| nML / nATS | 334 / 326 | Screen |
| ML Brier / Δ vs mkt | ~0.1967 / ~0.0188 | Screen M2/M3 **true** — **not** FINAL_EVAL |
| \|bias\| | ~0.066 | Screen M4 **true** |
| ATS Brier | ~0.260 | S2 fail — spreads path stopped |

---

## 4. Concrete execution plan (**before** any retrieval)

Ordered; **stop** until human authorizes the next paid/free build step. This turn executes **nothing** beyond this plan.

### Phase A — Freeze & harness (no Odds spend) — *ready now*

1. Keep clean E1 α=1.15 frozen; ATS tuning remains stopped.  
2. Add (when coding authorized) a **moneyline-only** score harness on clean E1 that:
   - scores M1–M4 only;
   - reports S2 as **out-of-scope / separate**;
   - refuses to read closes into features;
   - refuses to label FINAL_EVAL PASS from TUNING.  
3. Document stamp + α in every report header.

**Cost:** $0 · **FINAL_EVAL:** still untouched

### Phase B — Independent FINAL_EVAL fixture build (free ESPN first)

4. **Authorize** free ESPN pull for 2025 w8+ (+ completed 2026 RS) into new fixtures (e.g. `ncaaf-final-eval-*-games.json`) — **separate** from TUNING.  
5. Apply verified FBS–FBS tags; withhold FBS–FCS / unrated as today.  
6. Venue sidecar recovery (free ESPN `neutralSite`) before evaluableSupported claims.  
7. **Do not** score acceptance until closes exist.

**Cost:** $0 ESPN · **Still no Odds** until Phase C approved

### Phase C — FINAL_EVAL close ML retrieval (paid — needs explicit approval)

8. Confirm `ODDS_API_KEY` + remaining credits on a **paid** plan.  
9. Dry-run minute-bucket manifest for FINAL_EVAL games (`h2h` preferred for ML-only; optional `h2h,spreads` if shared with later ATS).  
10. Hard credit cap (example): **~2 000** for `h2h`-only 2025 w8–15; raise only with written approval.  
11. Pull → join → eval-only archive; never features.  
12. **Single** frozen E1 α=1.15 score on FINAL_EVAL → report M1–M4 once.

**Cost:** ~1.5k–2k credits (`h2h`) or ~3k+ (`h2h,spreads`) per window · **Not this turn**

### Phase D — Coach selection / CLV on clean E1 (paid early snaps — separate approval)

13. Authorize **early T−24h two-sided** historical `h2h` cache for the CLV window (FINAL_EVAL and/or forward).  
14. Apply R1–R4; never invent away ML.  
15. Run Coach pick CLV on **clean E1** stamp; apply C1–C6 unchanged.  
16. If C1–C3 fail again → **Failed evidence** (not missing); do not lower C2.

**Cost:** same order as a close pull for that window · **Not this turn**

### Phase E — Injury validation (E4)

17. Continue **forward** ESPN pre-kick collector ($0) for future slates.  
18. Historical holdout: only if a provider proves `captureTimestamp ≤ kickoff` — **review before any purchase**.  
19. Join null-safe labels; run known vs unknown \|edge\| segment test.  
20. E4 remains **OPEN** until that evidence exists.

**Cost:** $0 forward; paid historical **blocked** until timing proof

### Phase F — Human gate (E6)

21. Only after FINAL_EVAL M1–M4 PASS **and** CLV C1–C6 PASS **and** E4 clear (plus checklist E2E as required): flag-only PR for `NCAAF_GAME_LINE_SIM_VALIDATED`.  
22. Spreads stay disabled while S2 unmet (P3).

---

## 5. This-turn non-actions (hard)

- No Odds / early-snap / injury **spend**  
- No FINAL_EVAL fixture write  
- No deploy / OTA / unlock / gate flip  
- No ATS retune / α sweep / criteria edit  
- No claiming ML PASS from TUNING M3  

---

## 6. Summary — unmet ML path

| Item | Missing | Failed | Blocks ML final? |
|------|:-------:|:------:|:----------------:|
| FINAL_EVAL games+close ML | ✓ | | ✓ |
| FINAL_EVAL M1–M4 score | ✓ | | ✓ |
| Clean E1 Coach CLV early two-sided cache | ✓ | | ✓ |
| Phase-e CLV C1/C2/C3 (prior engine) | | ✓ | Historical warning; remake on clean |
| E4 historical injury | ✓ | | ✓ (gate) |
| TUNING M3 screen | | | **No** — not final |
| S2 ATS | | ✓ (TUNING) | **Spreads only** |

**Moneyline final validation:** not ready — blocked by **missing** FINAL_EVAL + CLV early cache + E4, with prior CLV **failed** evidence on the old stamp.

Fixture companion when executed later: keep reports under `docs/coach/` + `artifacts/api-server/test/fixtures/`; this file is the pre-retrieval contract.

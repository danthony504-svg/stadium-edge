# Final-fill shortfall: 7-leg NFL → 4 despite 9+99 qualified

**Branch:** `cursor/lean-preserve-qualified-def8` @ `5093d6da`  
**Probe:** live production board, ask `7 leg NFL`, 2026-10-08 (~11.8s)  
**Artifact:** `/tmp/diag-final-fill-pool.json`  
**Constraints:** read-only — no code change, no threshold/P0/correlation loosening, no sim-cap/48h change, no merge/deploy/OTA.

---

## Verdict

Coach is **not** exhausting remaining qualified independent candidates after lean.

**Exact root cause:** `buildCoachParlay` runs `enforceMlLeanOnPicks` on the staged ticket, then **returns** after football-mix finalize + ladder dedupe. It never calls `topUpTicketFromQualifiedScored` again. `qualifiedCandidates` (~109) are used only for lean **substitution**, not post-lean refill.

Staging already topped up to 6; lean shrinks to 4; final fill never re-walks the pool.

**Structural ceiling (unchanged rules, 1-game 48h NFL slate):** max **6** = `maxPropsPerGame(7)=2` + progressive GL ceiling `ceil(7/2)=4`. **7 is unreachable** without loosening caps, expanding the window, or seating P0 totals.

---

## Live final ticket (4)

| # | Market | Pick | Odds | Grade | simHit | edge |
|--:|--------|------|-----:|------:|-------:|-----:|
| 1 | Rec Yds | CeeDee Lamb Over 84.5 | −112 | B | 0.733 | 19.9% |
| 2 | Rec Yds | Jake Ferguson Under 26.5 | −111 | B− | 0.639 | 11.9% |
| 3 | Q1 Alt Spread | Cowboys +2.5 | −396 | B+ | 0.846 | 4.8% |
| 4 | 1H Alt Spread | Buccaneers +13.5 | −400 | B+ | 0.987 | 18.7% |

Lean note: updated 1 lean-side seat; dropped 2 anti-lean GLs that failed preserve constraints. Stale copy still claims “6 qualified picks were available” (pre-lean staging).

---

## 1) Nine qualified regular / alt player props

All on **TB @ DAL**. Evidence from live `qualifiedCandidates`.

| Player | Market | Line / side | Odds | Grade | simHit | edge | Alt? |
|--------|--------|-------------|-----:|------:|-------:|-----:|:----:|
| CeeDee Lamb | Rec Yds | Over 84.5 | −112 | B | 0.733 | 19.9% | no |
| Jake Ferguson | Rec Yds | Under 26.5 | −111 | B− | 0.639 | 11.9% | no |
| CeeDee Lamb | Rec Yds | Over 79.5 | −133 | B+ | 0.758 | 18.1% | **yes** |
| George Pickens | Rec Yds | Under 63.5 | −110 | B− | 0.619 | 10.1% | no |
| George Pickens | Rec Yds | Under 66.5 | −120 | B | 0.659 | 12.0% | no |
| Jake Ferguson | Rec Yds | Under 25.5 | −113 | B− | 0.616 | 9.1% | no |
| Dak Prescott | Pass TDs | Under 2.5 | −170 | B | 0.679 | 4.9% | no |
| George Pickens | Rec Yds | Under 62.5 | −113 | B− | 0.605 | 8.0% | no |
| George Pickens | Receptions | Under 4.5 | +103 | C+ | 0.519 | 1.8% | no |

**Counts:** qualified player props = **9**; alternate player props = **1** (CeeDee 79.5); main player props = **8**.

Supported NFL skill markets **do** clear when graded (Rec Yds, Receptions, Pass TDs). No qualified Rush Yds / Pass Yds on this run’s qualified set (may be among 56 simmed but below qualification bar — not a fill-path skip).

---

## 2) Alternate player props vs alternate game lines

| Pool | Count | Notes |
|------|------:|-------|
| Qualified total | **109** | ≈ prior “108 / 9+99” |
| Player props | **9** | above |
| Game lines (incl. period/alt spreads) | **100** | the “99 alts” |
| Alternate **player** props | **1** | not 99 |
| Alternate **game** lines | **~100** | period/alt spreads; P0 keeps team/game totals at 0 |

**Do not treat “99 qualified alternates” as 99 player-prop seats.**

---

## 3) Independent seating families

| Family key | Count |
|------------|------:|
| Unique player×market×side prop families | **5** |
| Unique GL `marketLadderKey` families | **7** |

Prop families: CeeDee Rec Over · Ferguson Rec Under · Pickens Rec Under · Dak Pass TD Under · Pickens Receptions Under.

GL ladders (live sample): Bucs 1H / Q1 / Q2 / FG alt / 2H / Q3 + **Cowboys Q1 only**. Lean-side Cowboys depth is thin (1 period family); Bucs dominate the alt GL pool.

---

## 4) Seats after hard correlation / ladder / GL caps

| Cap | Value | Effect on this slate |
|-----|------:|----------------------|
| `maxPropsPerGame(7)` | **2** | 3rd distinct player prop blocked |
| Same-player prop | 1 | CeeDee/Ferguson/Pickens threshold spam → 1 seat each |
| Same ladder | 1 rung | alt thresholds collapse |
| Hard `maxLegsPerGame(7)` | **2** | lean finalize |
| Progressive GL raise (top-up only) | **[3, 4]** | staging/top-up can seat up to 4 GLs |
| P0 totals | fail-closed | 0 total seats |

**Eligible independent opportunities after constraints:** **2 props + up to 4 GLs = 6** (not 7).

---

## 5) Does final fill search remaining candidates after lean?

| Stage | Searches pool? |
|-------|----------------|
| `boardMarketScanner` staging + `topUpTicketFromQualifiedScored` | **Yes** (pre-lean; reached 6) |
| `enforceMlLeanOnPicks` | Only for **same-family lean substitutes** |
| Post-lean in `buildParlay.ts` | **No top-up** — picks filtered/deduped and returned |

Code path (`buildParlay.ts` ~799–853): `rawPicks → lean → finalizeFootballPropMix → dedupe → return`. No `topUpTicketFromQualifiedScored`.

Hypothetical: calling existing `topUpTicketFromQualifiedScored(final4, scoredQualified, 7)` on the live pool → **6** picks (proves leftover seats exist under current caps).

---

## 6) Early stop / truncation / missing alt-prop fallback

| Mechanism | Role |
|-----------|------|
| **Missing post-lean top-up** | **Primary** — early return after lean shrink |
| `maxPropsPerGame=2` | Blocks 3rd prop (Pickens / Dak) even if fill ran |
| Progressive GL only inside top-up | Lean uses hard 2; without refill, stuck at 2 GLs |
| Prop sim batch 56 | Caps discovery; **does not** cause 4 vs 6 (2 prop seats already full) |
| No separate “alt player prop fallback” after lean | Alt player props are in the same qualified pool; only 1 alt prop exists; fill never reopens the pool |

---

## 7) Alt Rec/Rush/Pass/Receptions when graded?

Yes for markets that **qualified**: Rec Yds, Receptions, Pass TDs appear with real odds + sim grades. They are limited by **same-game prop cap (2)** and ladder/player dedupe — not by a missing market allowlist in final fill.

---

## 8–9) Proposed final-fill correction (not implemented)

**Smallest safe fix:** After lean (+ team/market filters) in `buildCoachParlay`, if `picks.length < target` and scan has scored/qualified leftovers, call existing `topUpTicketFromQualifiedScored` (already respects qualification, ladder, `maxPropsPerGame`, progressive GL raise, no filler invent). Then existing ladder dedupe + slate filters.

**Keep:** P0, qualification bars, same-player/ladder dedupe, correlation caps, 48h, sim caps, V2 off.

**Extra safety (recommended with the top-up):** when refilling GLs, skip opposite-side same-period hedges (e.g. do not add Bucs Q1 when Cowboys Q1 is seated). Naive top-up on this board added Bucs Q1 beside Cowboys Q1 — lean-coherent fill should prefer remaining **distinct-period** ladders (Q2/2H/FG) under progressive 3–4.

---

## 10) Report numbers + reject reasons for legs 5–7

| Metric | Value |
|--------|------:|
| Qualified alternate **player** props | **1** |
| Unique independent player/market opportunities | **5** families (9 rows) |
| Eligible after final ticket constraints | **6** max (2 props + 4 GLs) |
| Seated today | **4** |
| After safe post-lean top-up (existing caps) | **6** |
| Reach 7? | **No** under current rules on 1-game slate |

### Exact reject reasons for potential 5th / 6th / 7th

Given seated 4 (2 props + Cowboys Q1 + Bucs 1H):

| Seat | Best remaining candidates | Exact reject **today** (no post-lean fill) | Reject **if** post-lean top-up ran |
|-----:|---------------------------|---------------------------------------------|-------------------------------------|
| **5th** | Bucs Q2 / 2H / FG alt / Q3 (distinct ladders) | **No final-fill pass** — never considered after lean | **Eligible** under progressive raise to 3 |
| **6th** | Next distinct-period Bucs (or Cowboys if any) GL | **No final-fill pass** | **Eligible** under progressive raise to 4 |
| **7th** | George Pickens Rec / Dak Pass TDs / Pickens Receptions | **No final-fill pass**; even if considered: **`maxPropsPerGame(2)`** | Still **`maxPropsPerGame(2)`**; 5th GL blocked by progressive ceiling **4** |

Other pool rejects (not seats 5–7 specifically): same ladder (CeeDee 79.5, Ferguson 25.5, Bucs 1H threshold spam); hard `maxLegsPerGame(2)` until progressive runs.

### Expected composition after safe final-fill correction

Up to **6** legs, e.g.:

1. CeeDee Lamb Over 84.5 Rec Yds (−112, B)  
2. Jake Ferguson Under 26.5 Rec Yds (−111, B−)  
3. Cowboys Q1 Alt +2.5 (lean)  
4. Buccaneers 1H Alt +13.5 (preserved qualified)  
5. Buccaneers Q2 Alt +2.5 (or 2H/FG — distinct period)  
6. Another distinct-period Bucs/Cowboys GL under cap 4  

Still short of 7 → honest shortfall (1-game slate + prop cap + P0 totals). Copy should report **post-fill** seated count and thin-slate reason.

---

## Root cause (one line)

**Post-lean final fill is missing:** staging tops up to 6, lean shrinks to 4, and `buildCoachParlay` never re-invokes `topUpTicketFromQualifiedScored` on the remaining qualified pool; 7 remains structurally impossible under `maxPropsPerGame=2` + progressive GL ceiling 4 on a 1-game 48h NFL board.

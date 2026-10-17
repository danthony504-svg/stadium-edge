# FINAL_EVAL scoring-readiness report (cache-only)

**Paid HTTP:** 0 · **Scored:** false · **Deploy/OTA/unlock:** false  
**Membership / model / R1–R4 / C1–C6:** preserved (not edited)  
**Prediction inspection:** none

## Pairing (close ↔ early)

| Check | Result |
|-------|--------|
| Close matched | 364 |
| Early matched | 364 |
| Paired on same `gameId` | **364** |
| Close-only / early-only | 0 / 0 |
| Missing ID sets identical | **true** |
| Paired two-sided (home+away ML both archives) | **364** |

## Locked timing rules

| Rule | Result |
|------|--------|
| Close `snapshotTimestamp` < Odds `commence_time` | **364** ok / 0 fail |
| Early snap ~T−24h (audit band 20–28h) | **364** inside / 0 outside · mean=24.07h |
| Close requestDate = kickoff UTC minute | 364 ok / 0 mismatch |

## Missingness audit (n=44, cache-only)

| Puller reason | n |
|---------------|--:|
| no_odds_match | 39 |
| missing_two_sided_ml | 5 |

| Cache rematch probe | n |
|---------------------|--:|
| Alias/loose two-sided recoverable (close) | **39** |
| No join on cached close slate | **0** |
| `missing_two_sided_ml` (event found, empty books) | **5** |
| FCS-name heuristic hits | 1 |


**Empty bookmakers:** All 5 `missing_two_sided_ml` events are on the cached slate with `bookmakers=[]` (no h2h prices in the snapshot).

**Systematic?** **true** — Missingness is systematic: nearly all no_odds_match rows are ESPN↔Odds naming aliases (State/UMass/Appalachian/José/Hawaii/Southern Miss/apostrophe) recoverable from the same cached snapshots. The remaining missing_two_sided_ml rows are events present with zero bookmakers (empty price shell) — not credit-cap truncation.

Drivers:
- 39/44 puller no_odds_match (join/alias or absent from Odds slate)
- 39/44 recoverable via alias/loose join on cached close slate (cache-only rematch possible)
- 0/44 no recoverable join on cached close events (likely not on Odds NCAAF slate / naming gap beyond alias map)
- 5/44 missing_two_sided_ml
- 1/44 FCS-name heuristic hit (membership still FBS-scoped; heuristic only)
- Week concentration: {"8":6,"9":6,"10":3,"11":7,"12":6,"13":9,"14":7}

Repeated school tokens (≥2): sam houston(6), san jose state(6), massachusetts(6), app state(6), louisiana ragin(6), southern miss golden(6), hawaii rainbow(5), arkansas state red(3), ul monroe(2), troy(2), south alabama(2), texas state(2), san diego state(2)

## Coverage readiness (no scores)

### M1–M4 (moneyline)
| # | Criterion | Coverage ready | Evidence |
|---|-----------|:--------------:|----------|
| M1 | n≥200 decided + close ML | **true** | n=364 |
| M2 | brier &lt; 0.25 | sample ok / unscored | needs engine |
| M3 | ≤ market+0.02 | **true** | two-sided close ML=364 |
| M4 | |bias|≤0.08 | sample ok / unscored | needs engine |

### C1–C6 (Coach ML CLV)
| # | Criterion | Coverage ready | Evidence |
|---|-----------|:--------------:|----------|
| C1 | nMlWithClv≥50 | **true** | paired two-sided upper bound=364 |
| C2 | meanClv≥0 | not computed | deltas not inspected |
| C3 | beat-close≥0.45 | not computed | — |
| C4 | home/away≥20 | **true** | early two-sided=364 (R2 away path open) |
| C5 | soft gates | not run | — |
| C6 | PASS label | **false** | no scoring |

**Coverage verdict:** COVERAGE_READY_FOR_SCORING_ATTEMPT — sample thresholds for M1 and C1 upper-bound are met on paired archives; do not score until alias-missing policy accepted

## Recommendation

- **Score now:** **false**
- Cache-only audit complete. Matched paired coverage is adequate for M1 sample and C1 upper-bound, but 44 missing (mostly joins) should be policy-accepted or alias-rematched from cache before any FINAL_EVAL score. No paid HTTP. No scoring this turn.
- Next: cache-only alias rematch and/or accept MISSING_DATA — then separate scoring authorization
- Forbidden this turn: paid Odds · scoring · deploy · OTA · NCAAF unlock · lock edits

## Repro
```bash
cd artifacts/api-server
node --import ./test/register-hooks.mjs ./scripts/ncaafFinalEvalMissingCacheAudit.ts
```

# NCAAF restoration — consolidated release package

**Generated:** 2026-10-17 · branch `cursor/ncaaf-restoration-e2e-3645`  
**Base:** `cursor/ncaaf-final-eval-ml-archive-3645` @ `b000b2bb`  
**Authority:** one end-to-end restoration package — not a partial gate flip  
**Ops:** no spend · no production deploy/OTA · no unlock · voice paused · preview limited to existing cap/provenance candidate

Machine-readable twin: `artifacts/api-server/test/fixtures/ncaaf-restoration-release-package.json`.

---

## 1. Exact SHAs

| Ref | SHA | Role |
|-----|-----|------|
| FINAL_EVAL archive base | `b000b2bbec08b015bca220d42dd44319be16fa3c` | Frozen ML + E4 path tip |
| Frozen FINAL_EVAL score once | `b9772e541cf9a785fe45a4fe0298aa088d49e7ee` | M1–M4 + C1–C6 measured |
| E4 completion path lock | `b000b2bbec08b015bca220d42dd44319be16fa3c` | Prospective criteria locked |
| Restoration tip | `8c3d2bc47949667f7b340eca6cd5ecf024123063`| Per-market gates + Coach wiring + diagnosis |
| Cap/provenance preview (separate) | `f36294c17d6a99deda7ebdae23f6201058880d2e` | Already authorized preview only — **not** this NCAAF unlock |

**Stamp preserved:** `ncaaf-score-margin-v1-research` · α=`1.15` · candidate `E1_alpha_1_15` · nMl=403/408.

---

## 2. Markets — pass / fail / blocked

| Market | Research status | Product gate | Notes |
|--------|-----------------|:------------:|-------|
| **Moneyline** | **PASS metrics** (M1–M4 + C1–C6) | **false** | E4 + E6 block product; do not request E6 |
| **Spreads** | **FAIL vs coin** (separate S1–S4) | **false** | Settlement CLEARED; discrimination weak; S2 does **not** fail ML |
| **Totals** | **INSUFFICIENT_DATA** | **false** | No closing totals archive |
| **ALTs** | **INSUFFICIENT_DATA** | **false** | No posted ALT prices |

**P3 independence:** ML metrics clear does **not** unlock spreads/totals/ALTs. Spreads fail does **not** invalidate ML. Implemented as `NCAAF_MARKET_SIM_VALIDATED` per family + legacy `NCAAF_GAME_LINE_SIM_VALIDATED=false`.

---

## 3. Evidence (immutable FINAL_EVAL)

| Artifact | Role |
|----------|------|
| `docs/coach/ncaaf-final-eval-frozen-score.md` | Frozen score narrative |
| `artifacts/api-server/test/fixtures/ncaaf-final-eval-frozen-score.json` | Machine score (do not edit) |
| `docs/coach/ncaaf-ml-only-release-review.md` | ML_METRICS_CLEAR_E4_BLOCKER |
| `artifacts/api-server/test/fixtures/ncaaf-market-diagnosis.json` | Cache-only spreads/totals/ALTs diagnosis |
| `docs/coach/ncaaf-e4-completion-path.md` | Injury validation path (locked) |
| `docs/coach/ncaaf-injury-validation-path-complete.md` | Investigation finish + holds |

**Retune against FINAL_EVAL:** **no**. **Thresholds lowered:** **no**.

---

## 4. Injury — investigation finish + validation path

| Item | Status |
|------|--------|
| R4 behavioral policy | Done |
| R5 no backfill | Done |
| R1–R3 historical joins | OPEN_INSUFFICIENT_DATA |
| Default path | Forward ESPN prospective freezes (collector **inactive**) |
| Parallel $0 | ScoreTape Explorer sample verify (free key — not activated here) |
| M_base | Frozen; **no** injury adjust on FINAL_EVAL path (`predictE1Frozen` refuses availability) |
| M_inj | Separate; needs fresh prospective eval; never inherits FINAL_EVAL pass |

See [`ncaaf-injury-validation-path-complete.md`](./ncaaf-injury-validation-path-complete.md).

---

## 5. Spreads / totals / ALTs — gaps + local fixes shipped

| Gap | Local fix this package | Remaining |
|-----|------------------------|-----------|
| Single global gate risked cross-unlock | Per-market `NCAAF_MARKET_SIM_VALIDATED` + criteria modules | Human E6 per market later |
| S2 could conceptually muddy ML | `runAtsHarness` + `s2DoesNotAutoFailMl` / P3 | ATS model still fails coin |
| Rest unused for ATS research | `ats-rest-tilt-v0-research` helper (opt-in; not on M_base) | Nested TUNING folds + fresh eval |
| Totals/ALTs missing closes | Explicit INSUFFICIENT_DATA criteria (not FAIL) | Authorized Odds pull (see §7) |
| P0 telemetry looked like Coach failure | `blocked_unvalidated_market` digest-only | — |

---

## 6. Coach integration (verified candidates)

| Stage | Required | ML candidate | Spreads/totals/ALTs |
|-------|:--------:|:------------:|:-------------------:|
| Real odds | ✓ | Wired (blocked product) | Blocked |
| Matchup/context | ✓ | Wired | Blocked |
| Simulation | ✓ | Research unlock only | Blocked |
| Qualification | ✓ | C1–C6 evidence exists | N/A |
| Correlation | ✓ | Generic caps unchanged | N/A |
| ALT/refill | ✓ | Honest shortfall | Blocked (no prices) |
| Rendered ticket | ✓ | Short unavailable copy when P0 | N/A |

Code: `artifacts/stadium-mobile/lib/ncaafCoachIntegrationPath.ts` + per-market P0 in `coachP0UnvalidatedTotals.ts`.  
Isolated research delivery still uses `ncaafIsolatedCoachDelivery.mjs` (+ optional `NCAAF_ISOLATED_COACH_MARKETS=`).

**Other sports / startup / auth:** preserved — NCAAF gates are ncaaf-scoped; preview auth/cap work stays on its own tip.

---

## 7. Costs + consolidated external-data request

**This turn spent:** **$0** (no Odds HTTP, no paid injury API, collector inactive).

### Single consolidated request (after independent work — for human approval)

Only if historical injury depth or totals/ALTs archives are chosen over the $0 forward path:

1. **ScoreTape Explorer** — free key, 7-day CFB injury sample (`captured_ms` as-of proof). **$0**. Activate only to verify timing before any paid Desk.  
2. **Odds API historical** (only if totals/ALTs product path is prioritized): one capped pull with `NCAAF_E2B_MARKETS=h2h,spreads,totals,alternate_spreads` for FINAL_EVAL membership kickoffs — credit cap to be set by human; **not authorized now**.  
3. **ScoreTape Desk / SportsDataIO** — **do not purchase** until Explorer (or written guarantee) proves pre-kick as-of for CFB.

**Do not buy** anything solely because ML metrics cleared.

---

## 8. Deployment / rollback

### Deploy (not authorized)

- Production deploy: **no**  
- OTA: **no**  
- `NCAAF_GAME_LINE_SIM_VALIDATED` / per-market flips: **no**  
- Voice: **paused**  
- Preview: **only** existing cap/provenance candidate (`f36294c1`) — this restoration branch does not publish

### Rollback

1. Keep product gates false (default on this tip).  
2. If a mistaken unlock PR appears: revert that commit; do not “fix” by editing FINAL_EVAL JSON.  
3. Hard reset to archive base if needed: `git reset --hard b000b2bb`.  
4. Preview rollback: republish authorized `f36294c1` only.

---

## 9. Remaining blockers (honest)

1. E4 prospective sample floors (N1–N3) unmet — ~3–6 weeks forward ESPN or verified archive.  
2. E6 human sign-off — not requested while E4 open.  
3. Spreads ATS discrimination (S2) — model replacement / rest-tilt research, not threshold cuts.  
4. Totals + ALTs closing archives — paid Odds when authorized.  
5. Product unlock — flag-only PR after per-market evidence + E6.

---

## 10. Explicit non-actions

- No unvalidated injury tilt on frozen ML  
- No FINAL_EVAL rescore or threshold edits  
- No production/OTA/unlock  
- No voice resume  
- No additional spend without the §7 request approval  

# E4 injury investigation — finished path (no unvalidated ML tilt)

**Locked:** 2026-10-17 · restoration package  
**Frozen M_base:** `ncaaf-score-margin-v1-research` α=1.15 — **unchanged**  
**Product:** `NCAAF_MARKET_SIM_VALIDATED.moneyline=false` · legacy master false  
**Spend / collector / deploy / OTA / E6:** none this turn

---

## Verdict

Historical pre-kick injury joins for TUNING/FINAL_EVAL remain **unavailable**. The defensible completion path is:

1. **Default:** forward ESPN freezes + prospective E4-seg / E4-inj under locked N1–N6 / S1–S3 ([`ncaaf-e4-completion-path.md`](./ncaaf-e4-completion-path.md)).  
2. **Parallel $0:** ScoreTape Explorer sample to prove `captured_ms` as-of ≤ kickoff before any paid Desk.  
3. **Blocked until timing letter/sample:** SportsDataIO Vault / box-score `InjuryStatus`.

**Do not** attach `e4ConservativeAdjust` to frozen FINAL_EVAL scoring. `predictE1Frozen` refuses `availability` by type. M_inj requires a **fresh** prospective eval and never inherits FINAL_EVAL pass bits.

---

## Investigation close-out

| Requirement | Result |
|-------------|--------|
| R4 behavioral policy | **Met** — `e4Availability.ts` + tests |
| R5 no holdout backfill | **Met** — policy held |
| R1 pre-kick snapshots | **Open** — 0 historical joins |
| R2 join labels | **Open** — known=0 on holdouts |
| R3 segment conservatism | **Open** — `INSUFFICIENT_DATA` |

Provider docs reviewed (no key, no purchase): ScoreTape CFB injuries change-log; SportsDataIO game-start claim without as-of trail; ESPN live-only; CFBD/Odds have no injury family.

---

## Machine path (code)

| Module | Role |
|--------|------|
| `e4ProspectiveEval.ts` | Score E4-seg when joins exist; never clears product E4 |
| `e4Availability.ts` | Join labels + conservative adjust (M_inj only when called) |
| `ncaafPregameInjurySnapshotCollector.ts` | Prepared; **INACTIVE** without `NCAAF_INJURY_COLLECTOR_ACTIVE=1` |
| `predictE1Frozen` | M_base only — injury adjust forbidden |

Prospective criteria floors remain locked in `ncaaf-e4-completion-path-criteria.json` (N1≥60, N2/N3≥20, S1 null≤known).

---

## What would unblock E4 (human later)

1. Authorize collector activation **or** free ScoreTape Explorer verify.  
2. Freeze prospective membership before peeking at segment means.  
3. Score E4-seg on M_base edges; separately score E4-inj on M_inj.  
4. Only then consider E6 — still a human flag-only PR.

**Not authorized now:** purchase, collector cron, gate flip, injury on frozen ML.

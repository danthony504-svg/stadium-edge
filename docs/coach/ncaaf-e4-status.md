# E4 injury status — audit

**Status:** `OPEN_INSUFFICIENT_DATA` · **Resolved:** false · **E6 requested:** false  
**FINAL_EVAL score preserved:** yes (no retune)  
**Behavioral tests ≠ historical predictive validation**

## What E4 requires

| ID | Requirement | Satisfied by existing data? |
|----|-------------|:---------------------------:|
| R1_pre_kick_snapshots | Snapshots with captureTimestamp < kickoffIso covering Odds-listed FBS games under test (TUNING and/or FINAL_EVAL) | **false** |
| R2_join_labels | Join producing injuryKnown=true|null and optional qbOut — never coerce missing→false | **false** |
| R3_segment_conservatism | mean|edge| on injuryKnown=null ≤ mean|edge| on injuryKnown=true with documented n (≥20 each) | **false** |
| R4_behavioral_policy | Engine policy for known QB/player absences, stale reports, unavailable data (synthetic tests) | **true** |
| R5_no_backfill | Do not backfill historical labels from live ESPN or post-game box scores | **true** |

### Evidence notes
- **R1_pre_kick_snapshots:** 1 forward ESPN freeze(s); 0 historical holdout joins
- **R2_join_labels:** TUNING closes non-null injuryKnown=0/470; qbOut=0; phase-e injuryKnown=0/842
- **R3_segment_conservatism:** need ≥20 known and ≥20 null rows; got known=0 null=0
- **R4_behavioral_policy:** e4Availability.ts + ncaafClean.e4Availability.test.ts (behavioral only — not historical predictive validation)
- **R5_no_backfill:** Forward collector + README forbid holdout backfill; policy held

## Existing data inventory

| Source | n | injuryKnown non-null | qbOut non-null |
|--------|--:|---------------------:|---------------:|
| TUNING closes | 470 | 0 | 0 |
| Phase-e closes | 842 | 0 | 0 |
| Forward ESPN snapshots | 1 files | n/a (not joined to holdout) | n/a |

## Behavioral policy (done this turn)

Synthetic tests cover:

1. **Known QB / key player absences** — pre-kick usable snapshot → conservative margin tilt + σ widen  
2. **Stale / post-kick reports** — treated as unavailable; **no** invented adjustment  
3. **Unavailable injury data** — `injuryKnown=null`; never coerce null/false→healthy  

Module: `e4Availability.ts` · Tests: `ncaafClean.e4Availability.test.ts`

## Historical predictive validation (still blocked)

Segment conservatism on real joins: **INSUFFICIENT_DATA** — need ≥20 known and ≥20 null rows; got known=0 null=0

> Synthetic tests cannot replace missing historical evidence.

## Remaining blockers

- No verified historical pre-kick injury archive for TUNING or FINAL_EVAL games
- SportsDataIO / ScoreTape timing not proven / not purchased (see ncaaf-e4-injury-provider.md)
- Forward snapshot count insufficient for slate-wide capture < kickoff joins
- Segment conservatism unscored on real joins (INSUFFICIENT_DATA)

## Completion path (prepared)

See [`ncaaf-e4-completion-path.md`](./ncaaf-e4-completion-path.md): ScoreTape Explorer $0 sample verify → else forward ESPN prospective (~3–6 weeks in-season); M_base frozen vs M_inj fresh eval; criteria locked before results. No purchase / activation this audit.

## E6 gate

**Do not request E6** until E4 is resolved (`e4Resolved=true`).

## Ops

No deploy / OTA / unlock · spreads / totals / ALTs blocked · no paid retrieval this audit

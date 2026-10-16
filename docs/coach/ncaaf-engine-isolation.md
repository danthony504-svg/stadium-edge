# NCAAF research vs live engine isolation

**Tip:** `e6c26f85` research evidence remains the evaluation snapshot.  
**Live:** `ppg-per-drive-v1` (Render `e607f131`) — **unchanged**.  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false`.

## Impact check (proposed v1.1)

| Surface | Effect of residual SD 14.5 + home shrink 2.0 | Effect of global stamp bump to `v1.1` |
|---------|-----------------------------------------------|----------------------------------------|
| **NFL draws** | None (college-only math) | **Would** invalidate NFL cache fingerprints if stamp were global |
| **NCAAF product path** | Would change cover probs | Same stamp collision risk |
| **Other sports** | None (`nfl-drive` only) | None |

Conclusion: draw math was already NCAAF-gated, but a **global stamp bump was unsafe for NFL**. Isolation restores the live stamp.

## Isolation (current)

| Constant / flag | Live | Research |
|-----------------|------|----------|
| `FOOTBALL_DRIVE_ENGINE_VERSION` | `ppg-per-drive-v1` | — |
| `FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION` | — | `ppg-per-drive-v1.1-research` |
| Residual + shrink | **Off** | On only if `ncaafResearchCalibration: true` or `NCAAF_RESEARCH_CALIBRATION=1` |
| Mobile `COACH_GAME_SIM_ENGINE_VERSION` | `ppg-per-drive-v1` | Does not accept research stamp |
| Phase E offline scripts | pass `ncaafResearchCalibration: true` | Reproduce e6c26f85-class research runs |

NFL with `ncaafResearchCalibration: true` still ignores residual (college check). Unit: `nflDriveSimCaps.test.ts` isolation case.

## Holdout policy

| Window | Status |
|--------|--------|
| 2024 kickoff `< 2024-10-15` | **USED** (tuning lock for research residual/shrink + CLV selection) |
| 2024 kickoff `≥ 2024-10-15` | **USED** (untouched evaluation at e6c26f85) |
| 2025+ FBS (forward collection) | **RESERVED_UNTOUCHED** — do not tune until fixtures exist |

Further model tuning must wait for reserved data. Failure analysis on USED windows is allowed (no parameter lock changes).

# Milestone — Football C.2.3 role-aware anytime TD (shadow)

## Decision: **MODIFY → promote 0.3.3**

Role-aware anytime-TD intensity multipliers cleared the frozen holdout gate.
Named ESPN `athlete.id` identity and 0.3.2 yard-budget means/shock (σ=0.12) are preserved.
`pass_yds` PASS family did not regress.

Shadow-only. No `SIM_V2_SERVE`, allowlists, Coach, P0, PR#649, merge, or OTA.

## Params

| Param | Value |
|-------|-------|
| `FOOTBALL_PROP_MODEL_VERSION` | `"0.3.3"` |
| Yard means/shock profile | unchanged from 0.3.2 (`5.8·pts+90` / `2.0·pts+40` / `3.6·pts+55`, σ=0.12) |
| `FOOTBALL_PROP_TD_RATE_TEMPER` | `1.0` |
| Role TD mult qb | `0.756` |
| Role TD mult rb | `0.569` |
| Role TD mult wr / te / flex | `1.249` |
| Fit source | chrono **val only** (NFL 2023 + NCAAF 2024 w1–7), pooled |
| Fit method | `m=log(1−actual)/log(1−sim)`, shrink 0.85, clamp [0.45, 1.85], min-n 40 |
| Usage | snap / red-zone volume proxy when pregame RZ fields absent |

## Holdout verify (frozen chrono)

| Sport | Family | Arm | n | Brier | LogLoss | ECE |
|-------|--------|-----|---|-------|---------|-----|
| NFL | any_td | 0.3.2 | 1644 | 0.2394 | 0.6802 | 0.1455 |
| NFL | any_td | **0.3.3** | 1644 | **0.2152** | **0.6185** | **0.0479** |
| NFL | pass_yds | 0.3.2 | 2280 | 0.1626 | 0.4947 | 0.0261 |
| NFL | pass_yds | 0.3.3 | 2279 | 0.1627 | 0.4948 | 0.0250 |
| NCAAF | any_td | 0.3.2 | 2301 | 0.2179 | 0.6360 | 0.1152 |
| NCAAF | any_td | **0.3.3** | 2301 | **0.2022** | **0.5901** | **0.0407** |
| NCAAF | pass_yds | 0.3.2 | 3232 | 0.1764 | 0.5241 | 0.1187 |
| NCAAF | pass_yds | 0.3.3 | 3232 | 0.1760 | 0.5232 | 0.1187 |

Promotion rule satisfied: any_td ECE **and** Brier **and** LogLoss improve on NFL + NCAAF; pass_yds ECE/Brier/LL do not materially regress; aggregate ECE wins are accompanied by Brier/LL improvements (not ECE-only).

Role gaps (NFL holdout sim−actual): RB +0.261→+0.087, WR −0.109→−0.026, QB +0.078→+0.029.

## Files

| Path | Role |
|------|------|
| `src/models/football/playerProps.ts` | Role-TD mults + version 0.3.3 |
| `eval/runFootballPropC23.ts` | Val fit + holdout side-by-side |
| `FOOTBALL_C23_HOLDOUT.md` | Full metrics report |
| `MILESTONE_FOOTBALL_C23.md` | This decision |

## Blockers

- None for 0.3.3 promote on the stated gate.
- Closing-line family still **INSUFFICIENT** (no licensed archive).
- Residual any_td ECE (~0.048 NFL / ~0.041 NCAAF) still above 0.04 family gate — further shape work optional.
- Rush/rec dispersion not in scope for this milestone.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm eval:prop-c23
```

## Non-goals

Serve flags, family allowlists, Coach wiring, production OTA.

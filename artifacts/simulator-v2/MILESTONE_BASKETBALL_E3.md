# Milestone — Basketball E.3 league-specific one-factor (shadow)

## Decision: **KEEP v0.2.0 for NBA, WNBA, NCAAB**

No league cleared the promotion rule (holdout ECE **and** Brier **and** LogLoss improve vs v0.2).
Settlement / testing improvements retained. Parameters not shared across leagues.

Shadow-only. `SIM_V2_SERVE=off`. Allowlists empty. No Coach / P0 / PR #649 / merge / OTA.

## Candidates (one factor each)

| League | Candidate | Factor | Promote |
|--------|-----------|--------|---------|
| NBA | `nba_e3` | shrink 0.15 | **NO** — ECE/Brier/LL all worse |
| WNBA | `wnba_e3` | none (alias v0.2) | **NO** — no candidate (prior ablation all hurt) |
| NCAAB | `ncaab_e3` | shrink 0.2 | **NO** — ECE↓ but Brier/LL↑ (ECE-only blocked) |

## Holdout (identical games, 2k draws)

| League | Arm | n | Brier | LogLoss | ECE |
|--------|-----|---|-------|---------|-----|
| NBA | v0.2 | 927 | 0.2270 | 0.6481 | 0.0613 |
| NBA | nba_e3 | 927 | 0.2284 | 0.6499 | 0.0703 |
| WNBA | v0.2 | 531 | 0.2232 | 0.6378 | 0.0612 |
| NCAAB | v0.2 | 1188 | 0.2224 | 0.6335 | 0.0534 |
| NCAAB | ncaab_e3 | 1188 | 0.2227 | 0.6347 | 0.0485 |

## Gates

Every main family remains **FAIL** or **INSUFFICIENT** vs `minOos=500` / `maxEce=0.04`.
No market family promoted.

## Files

| Path | Role |
|------|------|
| `src/models/basketball/jointBasketball.ts` | E.3 profile slots; `E3_PROMOTED` stays all `v0.2` |
| `eval/runBasketballE3.ts` | Per-league holdout verifier |
| `eval/report/BASKETBALL_E3.md` | Full gate tables |
| `MILESTONE_BASKETBALL_E3.md` | This decision |

## Blockers

- NBA / WNBA / NCAAB main ECE still > 0.04 under v0.2
- Per-market n often &lt; 500 on this holdout slice
- Closing-line archive INSUFFICIENT
- No Coach integration until provider→normalize→sim→settle→qualify complete

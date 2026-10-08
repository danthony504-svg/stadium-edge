# Football C.2.3 holdout — role-aware anytime TD (shadow)

Named ESPN `athlete.id` only. Yard-budget means/shock preserved from **0.3.2** (σ=0.12).
Role TD multipliers fitted on **val fold only**; holdout frozen for verify.

- Draws/game: 2000 (CI deep 10000)
- Default model version in tree after promote: **0.3.3**
- Promotion decision: **MODIFY** → **promoted 0.3.3** (baked role-TD mults)
- Yard shock σ=0.12; tdTemper=1 (unchanged from 0.3.2)
- Baseline arm used explicit identity role-TD knobs (= 0.3.2 generative TD)

## Val-fold fit (NOT holdout)

Pooled NFL+NCAAF val role occurrence → Bernoulli intensity multipliers
`m = log(1−actual)/log(1−sim)` with shrink 0.85 and clamp [0.45, 1.85]; n&lt;40 → 1.
TE/flex inherit WR (receiving leaders mapped to `wr` in eval roster).

| Role | Fitted mult |
|------|-------------|
| qb | 0.756 |
| rb | 0.569 |
| wr | 1.249 |
| te | 1.249 |
| flex | 1.249 |

### Val role gaps (baseline 0.3.2)

| Sport | Role | n | actualOcc | simRate | gap |
|-------|------|---|-----------|---------|-----|
| nfl | qb | 570 | 0.819 | 0.896 | 0.077 |
| nfl | rb | 519 | 0.486 | 0.735 | 0.249 |
| nfl | wr | 550 | 0.422 | 0.337 | -0.084 |
| ncaaf | qb | 686 | 0.824 | 0.923 | 0.099 |
| ncaaf | rb | 599 | 0.528 | 0.788 | 0.260 |
| ncaaf | wr | 674 | 0.488 | 0.410 | -0.078 |

## Frozen holdout side-by-side

# NFL holdout

### any_td

| Arm | n | Brier | LogLoss | ECE | meanP | meanY |
|-----|---|-------|---------|-----|-------|-------|
| 0.3.2 baseline | 1644 | 0.2394 | 0.6802 | 0.1455 | 0.667 | 0.595 |
| C.2.3 candidate | 1644 | 0.2152 | 0.6185 | 0.0479 | 0.624 | 0.595 |
| Δ (cand−base) | — | -0.0242 | -0.0618 | -0.0976 | -0.044 | 0.000 |

### pass_yds

| Arm | n | Brier | LogLoss | ECE | meanP | meanY |
|-----|---|-------|---------|-----|-------|-------|
| 0.3.2 baseline | 2280 | 0.1626 | 0.4947 | 0.0261 | 0.280 | 0.302 |
| C.2.3 candidate | 2279 | 0.1627 | 0.4948 | 0.0250 | 0.280 | 0.302 |
| Δ (cand−base) | — | 0.0001 | 0.0000 | -0.0010 | 0.000 | 0.000 |

### player_prop (overall)

| Arm | n | Brier | LogLoss | ECE | meanP | meanY |
|-----|---|-------|---------|-----|-------|-------|
| 0.3.2 baseline | 8475 | 0.1736 | 0.5305 | 0.0564 | 0.470 | 0.466 |
| C.2.3 candidate | 8476 | 0.1688 | 0.5177 | 0.0379 | 0.462 | 0.466 |
| Δ (cand−base) | — | -0.0048 | -0.0128 | -0.0184 | -0.008 | -0.000 |

### any_td role gaps

| Arm | Role | n | actualOcc | simRate | gap |
|-----|------|---|-----------|---------|-----|
| 0.3.2 | qb | 570 | 0.825 | 0.903 | 0.078 |
| 0.3.2 | rb | 516 | 0.486 | 0.748 | 0.261 |
| 0.3.2 | wr | 558 | 0.461 | 0.352 | -0.109 |
| C.2.3 | qb | 570 | 0.825 | 0.854 | 0.029 |
| C.2.3 | rb | 516 | 0.486 | 0.574 | 0.087 |
| C.2.3 | wr | 558 | 0.461 | 0.434 | -0.026 |

# NCAAF holdout

### any_td

| Arm | n | Brier | LogLoss | ECE | meanP | meanY |
|-----|---|-------|---------|-----|-------|-------|
| 0.3.2 baseline | 2301 | 0.2179 | 0.6360 | 0.1152 | 0.711 | 0.638 |
| C.2.3 candidate | 2301 | 0.2022 | 0.5901 | 0.0407 | 0.678 | 0.638 |
| Δ (cand−base) | — | -0.0157 | -0.0459 | -0.0745 | -0.033 | 0.000 |

### pass_yds

| Arm | n | Brier | LogLoss | ECE | meanP | meanY |
|-----|---|-------|---------|-----|-------|-------|
| 0.3.2 baseline | 3232 | 0.1764 | 0.5241 | 0.1187 | 0.386 | 0.267 |
| C.2.3 candidate | 3232 | 0.1760 | 0.5232 | 0.1187 | 0.386 | 0.267 |
| Δ (cand−base) | — | -0.0003 | -0.0009 | -0.0000 | -0.000 | 0.000 |

### player_prop (overall)

| Arm | n | Brier | LogLoss | ECE | meanP | meanY |
|-----|---|-------|---------|-----|-------|-------|
| 0.3.2 baseline | 11992 | 0.1892 | 0.5688 | 0.0731 | 0.525 | 0.477 |
| C.2.3 candidate | 11991 | 0.1859 | 0.5594 | 0.0663 | 0.518 | 0.477 |
| Δ (cand−base) | — | -0.0033 | -0.0095 | -0.0069 | -0.006 | -0.000 |

### any_td role gaps

| Arm | Role | n | actualOcc | simRate | gap |
|-----|------|---|-----------|---------|-----|
| 0.3.2 | qb | 808 | 0.834 | 0.926 | 0.092 |
| 0.3.2 | rb | 715 | 0.596 | 0.792 | 0.196 |
| 0.3.2 | wr | 778 | 0.474 | 0.412 | -0.062 |
| C.2.3 | qb | 808 | 0.834 | 0.887 | 0.053 |
| C.2.3 | rb | 715 | 0.596 | 0.627 | 0.032 |
| C.2.3 | wr | 778 | 0.474 | 0.506 | 0.032 |

## Promotion gate

Require: NFL+NCAAF `any_td` each improve ECE **and** Brier **and** LogLoss; `pass_yds` ECE/Brier/LL must not regress; reject aggregate ECE↑ with Brier/LL↓.

- **Decision: MODIFY** (promote 0.3.3 = YES) — applied in `playerProps.ts`
- Reasons: nfl_any_td_dECE=-0.0976_dBrier=-0.0242_dLL=-0.0618; ncaaf_any_td_dECE=-0.0745_dBrier=-0.0157_dLL=-0.0459; nfl_pass_yds_dECE=-0.0010_dBrier=0.0001_dLL=0.0000; ncaaf_pass_yds_dECE=-0.0000_dBrier=-0.0003_dLL=-0.0009; nfl_player_prop_dECE=-0.0184_dBrier=-0.0048_dLL=-0.0128; ncaaf_player_prop_dECE=-0.0069_dBrier=-0.0033_dLL=-0.0095
- Blockers: none
- See `MILESTONE_FOOTBALL_C23.md`

## Identity / non-goals

- Named athlete.id preserved; proxies rejected
- PASS family (`pass_yds`) means/shock unchanged from 0.3.2
- No serve / allowlists / Coach / P0 / PR649 / merge / OTA

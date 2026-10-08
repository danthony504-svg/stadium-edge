# NHL coverage matrix (shadow-only)

Gates: `minOos=500`, `maxEce=0.04`. Production serve / allowlists remain **off**.

Evidence: `eval/report/NHL_ML_N_EXPAND.md`, `eval/report/NHL_PROP_DIAGNOSE.md`, `eval/report/NHL_ML_REG_DIAGNOSE.md`, `MILESTONE_NHL_DECISION.md`.

Default profile: hockey.joint **v0.3** (form shrink **0.45**, shock σ0.15, HFA 0.08).

| Family | Verdict | n | ECE | Brier | LogLoss | Notes |
|--------|---------|---|-----|-------|---------|-------|
| `nhl:ml_final` | **PASS** | 650 | 0.0308 | 0.2478 | 0.6887 | KEEP; preserved vs 0.0313 @ shrink 0.40 |
| `nhl:ml_regulation` | **PASS** | 650 | 0.0380 | 0.2504 | 0.6944 | KEEP after val lever shrink 0.45 |
| `nhl:prop_goals` | **FAIL** | 520 | 0.0703 | 0.1481 | 0.4751 | Mapping OK; model residual |
| `nhl:prop_assists` | **FAIL** | 520 | 0.0412 | 0.1782 | 0.5427 | Assists key fixed; near gate |
| `nhl:prop_points` | **FAIL** | 520 | 0.0773 | 0.2360 | 0.6651 | points=G+A actuals |
| `nhl:prop_sog` | **FAIL** | 520 | 0.4203 | 0.3681 | 0.9419 | shotsTotal path fixed; λ residual |
| `nhl:prop_saves` | **INSUFFICIENT** | 259 | 0.3249 | 0.3538 | 0.9871 | n&lt;500; goalie saves/SV mapped |
| `nhl:prop_alts` | **FAIL** | 1560 | 0.1530 | 0.1158 | 0.3707 | alt ast/pts/sog |
| `nhl:player_prop_named` | **FAIL** | 3899 | 0.1609 | — | — | Aggregate after mapping (before≈0.303) |
| `nhl:spread` / puck | **INSUFFICIENT** | &lt;500 | — | — | — | Do not enable without n≥500 |
| `nhl:total_*` | **INSUFFICIENT** | &lt;500 | — | — | — | Do not enable without n≥500 |
| `nhl:team_total` / main_all / alt_all | **FAIL** | prior A/B | — | — | — | Prior ECE fail where n≥500 |
| closing_line_benchmark | **INSUFFICIENT** | — | — | — | — | Unlicensed |
| **NHL model enable** | **NO** | — | — | — | — | Shadow-only |

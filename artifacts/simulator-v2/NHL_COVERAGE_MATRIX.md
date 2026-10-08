# NHL coverage matrix (shadow-only)

Gates: `minOos=500`, `maxEce=0.04`. Production serve / allowlists remain **off**.

Evidence: `eval/report/NHL_ML_N_EXPAND.md`, `eval/report/NHL_PROP_DIAGNOSE.md`, `eval/report/NHL_ML_REG_DIAGNOSE.md`, `MILESTONE_NHL_DECISION.md`.

| Family | Verdict | n | ECE | Brier | LogLoss | Notes |
|--------|---------|---|-----|-------|---------|-------|
| `nhl:ml_final` | **PASS** | 650 | 0.0313 | 0.2478 | 0.6888 | KEEP shadow default v0.3 |
| `nhl:ml_regulation` | **FAIL** | 650 | 0.0439 | 0.2510 | 0.6958 | n OK; ECE gate fail; no clear val-only lever |
| `nhl:prop_goals` | *(see prop re-eval)* | — | — | — | — | Updated in `NHL_PROP_DIAGNOSE.md` after mapping audit |
| `nhl:prop_assists` | *(see prop re-eval)* | — | — | — | — | Assists key was unparsed; fixed |
| `nhl:prop_points` | *(see prop re-eval)* | — | — | — | — | Derived goals+assists |
| `nhl:prop_sog` | *(see prop re-eval)* | — | — | — | — | `shotsTotal` mapping |
| `nhl:prop_saves` | *(see prop re-eval)* | — | — | — | — | Goalie `saves` / SV |
| `nhl:prop_alts` | *(see prop re-eval)* | — | — | — | — | alt ast/pts/sog lines |
| `nhl:player_prop_named` | **FAIL** | — | — | — | — | Aggregate after mapping; residual model λ |
| `nhl:spread` / puck | **INSUFFICIENT** | &lt;500 | — | — | — | Do not enable without n≥500 |
| `nhl:total_*` | **INSUFFICIENT** | &lt;500 | — | — | — | Do not enable without n≥500 |
| `nhl:team_total` / main_all / alt_all | **FAIL** | prior A/B | — | — | — | Prior ECE fail where n≥500 |
| closing_line_benchmark | **INSUFFICIENT** | — | — | — | — | Unlicensed |
| **NHL model enable** | **NO** | — | — | — | — | Shadow-only |

Prop family cells are filled by the latest `eval:nhl-prop-diagnose` run (per-family ECE/Brier/LL/n in that report).

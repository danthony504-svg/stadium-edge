# Simulator V2 — coverage matrix (post C.2.3 / NHL mapping / E.3 / F5)

Shadow development only. Gates: `minOosSample=500`, `maxEce=0.04`.
`SIM_V2_SERVE=off`. Production allowlists empty. Coach / P0 / PR #649 unchanged.

| Sport | Family | Verdict | n | ECE | Notes |
|-------|--------|---------|---|-----|-------|
| NFL | pass_yds | **PASS** | ~2280 | ~0.025 | Preserved under prop 0.3.3 |
| NFL | any_td | **FAIL** | 1644 | 0.0479 | C.2.3 role mults; improved vs 0.145; still &gt;0.04 |
| NCAAF | any_td | **FAIL** | 2301 | 0.0407 | Near-gate after C.2.3 |
| NCAAF | pass_yds | **FAIL** | 3232 | 0.1187 | Unchanged; not C.2.3 scope |
| NHL | ml_final | **PASS** | 650 | 0.0308 | Preserved |
| NHL | ml_regulation | **PASS** | 650 | 0.0380 | After shrink 0.45 val lever |
| NHL | prop_goals/ast/pts/sog | **FAIL** | ≥520 | 0.04–0.42 | Mapping fixed; λ residual |
| NHL | prop_saves | **INSUFFICIENT** | 259 | 0.325 | n&lt;500 |
| NHL | spread/total | **INSUFFICIENT** | &lt;500 | — | Gated |
| NBA | main_all | **FAIL** | 927 | 0.0613 | E.3: keep v0.2 |
| WNBA | main_all | **FAIL** | 531 | 0.0612 | E.3: keep v0.2 |
| NCAAB | main_all | **FAIL** | 1188 | 0.0534 | E.3: ECE-only candidate rejected |
| MLB | f5 | **FAIL** | 1680 | 0.0486 | Near-gate under default v0.3.1; not allowlisted |
| MLB | fg_ml / team_total | **FAIL** | — | &gt;0.10 | v0.3.2 not promoted |
| MLB | prop_hits | **PASS** | 1200 | — | Named |
| MLB | prop_hr/rbi/sb | **FAIL** | 1200 | — | Named |
| MLB | prop_k | **INSUFFICIENT** | 240 | — | Named |
| All | closing_line | **INSUFFICIENT** | — | — | Unlicensed archive |
| All | production enable | **NO** | — | — | Shadow-only |

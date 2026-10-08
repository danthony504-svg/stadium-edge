# Milestone — NHL decision (shadow-only)

**Do not enable the whole NHL model.** `SIM_V2_SERVE` stays off; production allowlists unchanged. Coach / P0 / merge / OTA untouched.

Evidence:
- Expanded ML holdout (post shrink 0.45): `eval/report/NHL_ML_N_EXPAND.md` (n=650)
- ML regulation val lever screen: `eval/report/NHL_ML_REG_DIAGNOSE.md`
- Prop mapping audit + OOS: `eval/report/NHL_PROP_DIAGNOSE.md`
- Coverage matrix: `NHL_COVERAGE_MATRIX.md`
- Prior A/B (n=316): `eval/report/NHL_AB_HOLDOUT.md`

Gates unchanged: `minOos=500`, `maxEce=0.04`.

---

## KEEP (independently supported)

| Family | Profile | n | ECE | Notes |
|--------|---------|---|-----|-------|
| `nhl:ml_final` | v0.3 (shrink **0.45**) | **650** | **0.0308** | PASS on expanded chrono holdout. Preserved vs prior 0.0313 @ shrink 0.40. |
| `nhl:ml_regulation` | v0.3 (shrink **0.45**) | **650** | **0.0380** | PASS after smallest val-only lever (was FAIL ECE 0.0439 @ shrink 0.40). |

v0.3 levers (form shrink **0.45** + lognormal σ0.15 + HFA 0.08) are the **shadow default**. Shrink 0.40→0.45 chosen on early-2024 val only, then confirmed on frozen holdout — not a production allowlist.

---

## MODIFY (params / model)

| Item | Decision |
|------|----------|
| hockey.joint form shrink | **0.45** (was 0.40). Smallest clear val lever; holdout re-graded. |
| SOG / assists / points / saves boxscore mapping | **Fixed** in `eval/nhlEspnShared.ts` (see mapping list below) |
| Prop usage / SOG λ / saves λ | Residual model overconfidence after path fixes — next milestone; not holdout-tuned |

### Mapping fixes (named-player audit)
1. `shotsTotal` → skater SOG (legacy `/^(sog\|shots?)$/i` miss)
2. `assists` machine key + label `A` (was unparsed → actual=0)
3. `points` = goals+assists when ESPN omits points column
4. `plusMinus` machine key + label `+/-` (audit coverage)
5. Label mode: `S`→SOG; never label `SOG` (that is shootoutGoals)
6. Goalie: `saves` / `SV`; `goalsAgainst`≠goals; `shootoutSaves`≠saves

---

## INSUFFICIENT

| Family | Notes |
|--------|-------|
| spread / total_* / alt_* (non-prop) | Prior A/B n&lt;500; not re-expanded here. **Do not enable without n≥500.** |
| `nhl:prop_saves` | n=259 &lt;500 after mapping re-eval (ECE≈0.325 residual) |
| closing_line_benchmark | Unlicensed |

---

## FAIL

| Family | Verdict | n | ECE | Evidence |
|--------|---------|---|-----|----------|
| `nhl:prop_goals` | **FAIL** | 520 | 0.0703 | Mapping OK; model λ residual |
| `nhl:prop_assists` | **FAIL** | 520 | 0.0412 | Near gate; residual after assists parse fix |
| `nhl:prop_points` | **FAIL** | 520 | 0.0773 | Derived actuals; model residual |
| `nhl:prop_sog` | **FAIL** | 520 | 0.4203 | Path fixed; sim mean≪actual mismatch |
| `nhl:prop_alts` | **FAIL** | 1560 | 0.1530 | alt ast/pts/sog |
| `nhl:player_prop_named` | **FAIL** | 3899 | 0.1609 | Aggregate after mapping (was ≈0.303 broken / ≈0.283 SOG-only fix) |
| `nhl:team_total` / `main_all` / `alt_all` | **FAIL** | prior A/B | — | Prior ECE fail |
| Whole NHL serve / allowlists | **FAIL to enable** | — | — | No production enablement |

---

## Per-family decision board (shadow)

| Family | Decision | Why |
|--------|----------|-----|
| ml_final | **KEEP** (shadow) | n=650, ECE=0.0308 PASS |
| ml_regulation | **KEEP** (shadow) | n=650, ECE=0.0380 PASS after shrink 0.45 |
| spread / total_* / alt_* | **INSUFFICIENT** | n&lt;500; do not enable |
| team_total / main_all / alt_all | **FAIL** | Prior A/B ECE gate fail |
| prop_goals / assists / points / sog / alts | **FAIL** | Mapping fixed; model residual |
| prop_saves | **INSUFFICIENT** | n=259 |
| player_prop_named | **FAIL** | Aggregate ECE 0.1609 |
| closing_line_benchmark | **INSUFFICIENT** | Unlicensed |
| **NHL model enable** | **NO** | Do not allowlist / serve |

---

## Next milestone

1. **Props D.3:** TOI/role-conditioned usage; retune SOG base λ and goalie saves λ against **train/val only**; re-grade named props OOS (target ECE≤0.04, n≥500). Keep mapping fixes.
2. Expand saves sample to n≥500; re-expand non-ML team markets to n≥500.
3. Still **shadow-only** until family-by-family acceptance — never flip whole-NHL serve in one shot.

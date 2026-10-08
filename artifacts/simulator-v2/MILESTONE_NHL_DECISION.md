# Milestone — NHL decision (shadow-only)

**Do not enable the whole NHL model.** `SIM_V2_SERVE` stays off; production allowlists unchanged. Coach / P0 / merge / OTA untouched.

Evidence:
- Expanded ML holdout: `eval/report/NHL_ML_N_EXPAND.md` (n=650)
- Prop diagnose: `eval/report/NHL_PROP_DIAGNOSE.md`
- Prior A/B (n=316): `eval/report/NHL_AB_HOLDOUT.md`

Gates unchanged: `minOos=500`, `maxEce=0.04`.

---

## KEEP (independently supported)

| Family | Profile | n | ECE | Notes |
|--------|---------|---|-----|-------|
| `nhl:ml_final` | v0.3 | **650** | **0.0313** | PASS on expanded chrono holdout. Only family with n≥500 and ECE≤0.04. |

v0.3 levers (form shrink 0.4 + lognormal σ0.15 + HFA 0.08) beat v0.2 on the same expanded ML freeze (ml_final ECE 0.0527 → 0.0313). Preserve those params as the **shadow default** — not a production allowlist.

---

## MODIFY (params / model — not holdout-tuned here)

| Item | Decision |
|------|----------|
| hockey.joint calibration profile | Keep **v0.3** as default for shadow eval; v0.2 remains frozen A/B baseline only |
| `ml_regulation` | v0.3 still better than v0.2 (ECE 0.0682 → **0.0439** at n=650) but **above** 0.04 → needs further model work, not gate KEEP |
| SOG boxscore mapping | **Fixed**: ESPN `shotsTotal` → skater SOG (`eval/nhlEspnShared.ts` `boxStatIndices`) |
| Prop usage / SOG λ / saves λ | Residual overconfidence after path fix (sim SOG mean≈3.6 vs actual≈1.8; saves mean≈31 vs≈26). Next milestone — not tuned on this holdout |

---

## INSUFFICIENT (ML n — resolved for sample size)

| Family | Prior (A/B cap 320) | After densify expand |
|--------|---------------------|----------------------|
| `ml_regulation` | n=316, ECE≈0.033 → INSUFFICIENT (n&lt;500) | **n=650**, ECE=0.0439 → sample OK; verdict **FAIL** (ECE) |
| `ml_final` | n=316, ECE≈0.041 → INSUFFICIENT | **n=650**, ECE=0.0313 → **PASS** |

Fetch expand: daily ESPN dates + week fallback; seasons 2022–2024 for form priors; holdout graded cap 650 on mid+late chrono pool (pool=1239). ESPN data **does** allow n≥500.

Closing lines remain **INSUFFICIENT** (unlicensed) — unchanged.

Other A/B families at n=316 (spread / totals / alts) stay **INSUFFICIENT** until re-graded at n≥500; not re-run in this ML-only expand.

---

## FAIL

| Family | Verdict | Evidence |
|--------|---------|----------|
| `nhl:player_prop_named` | **FAIL** | Broken-path ECE≈0.397 (bias≈0.396) reproduced; root cause **`boxscore_sog_path_miss_shotsTotal`**. After fix ECE≈0.283 still ≫0.04 |
| `nhl:team_total` / `main_all` / `alt_all` | **FAIL** (prior A/B) | ECE above gate at n≥500 where applicable; not promoted |
| Whole NHL serve / allowlists | **FAIL to enable** | No production enablement from this milestone |

### Prop ECE≈0.393 root cause (summary)

1. **Primary (eval actuals):** Legacy SOG regex `/^(sog|shots?)$/i` missed ESPN `shotsTotal` → all skater SOG actuals = 0 while sim P(over 2.5/3.5) stayed high → ~480/840 obs drove bias/ECE ≈ 0.39.
2. **Not identity:** Athlete IDs verified; home/away sides balanced in diagnose.
3. **Residual after path fix:** SOG/saves λ too high vs boxscore (model defect) → still FAIL. Blocker for props: **calibrated player SOG/saves generators + role/TOI usage**, without holdout knob-turning on this freeze.

---

## Per-family decision board (shadow)

| Family | Decision | Why |
|--------|----------|-----|
| ml_final | **KEEP** (shadow) | n=650, ECE=0.0313 PASS (v0.3) |
| ml_regulation | **MODIFY** | n=650 OK; ECE=0.0439 FAIL; v0.3 helps vs v0.2 but not enough |
| spread / total_* / alt_* | **INSUFFICIENT** | Prior A/B n&lt;500; not re-expanded here |
| team_total / main_all / alt_all | **FAIL** | Prior A/B ECE gate fail |
| player_prop_named | **FAIL** | Path bug fixed; residual model FAIL |
| closing_line_benchmark | **INSUFFICIENT** | Unlicensed |
| **NHL model enable** | **NO** | Do not allowlist / serve |

---

## Next milestone

1. **Props D.3:** TOI/role-conditioned usage; retune SOG base λ and goalie saves λ against **train/val only**; re-grade named props OOS (target ECE≤0.04, n≥500). Keep SOG `shotsTotal` mapping.
2. **Regulation ML:** Diagnose 0.0439 residual (likely still form/HFA sharpness); train/val-only levers; re-holdout.
3. Re-expand non-ML families to n≥500 on the densified freeze for a full gate board.
4. Still **shadow-only** until family-by-family acceptance — never flip whole-NHL serve in one shot.

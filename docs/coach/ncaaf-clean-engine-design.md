# Clean research-only NCAAF engine — architecture & milestones (design freeze)

**Status:** DESIGN **FROZEN** · clean E1 α=1.15 · **Phase A harness executed** · **B/C/D/E prepared** ([`ncaaf-clean-phase-a-e-prep.md`](./ncaaf-clean-phase-a-e-prep.md)) · FINAL_EVAL **unscored** · no paid retrieval  
**Branch:** `cursor/ncaaf-clean-engine-design-8b51`  
**Date:** 2026-10-17  
**Supersedes as research path:** drive residual/shrink restoration and team-strength v0 (both **archived**, not extended)  
**Does not change:** live stamp `ppg-per-drive-v1` · `NCAAF_GAME_LINE_SIM_VALIDATED=false` · FINAL_EVAL empty · production freeze · voice paused

### Frozen decisions (2026-10-17)

| # | Topic | Decision |
|---|--------|----------|
| 1 | Stamp | **`ncaaf-score-margin-v1-research`** (exact) |
| 2 | Unknown venue | Stay **`unknown`**. Attempt source recovery. If unresolved → **`evaluableSupported=false`** (`venue_unknown_material`). **Do not** silently treat as neutral (do not rewrite `kind` to `neutral`; do not apply home HFA). **`evaluableSupported` ≠ production approval** (`productionReleaseApproved` always false on this stamp). |
| 3 | ML ties | Model two-way finals **including OT**. Historical tied/invalid finals → **exclude and report**; **no** half-wins. |
| 4 | Historical injury | `injury_unavailable` allowed for research with **no invented adjustment**. Does **not** satisfy injury validation. |
| 5 | Ablation freeze | **A0_full** locked as research baseline. A1/A2/A3 closed not adopted. See [`ncaaf-clean-a0-next-experiment.md`](./ncaaf-clean-a0-next-experiment.md). |

---

## 0. Why a clean engine (not another lever)

| Closed path | Outcome | Decision |
|-------------|---------|----------|
| Drive research (`ppg-per-drive-v1.1-research` + residual 14.5 / shrink 2.0) | TUNING M3/S2 fail; USED 2024 exhausted for retune | **Stop extending** |
| Team-strength v0 (`ncaaf-team-strength-v0-research`) | Identical-334: M3 fail (Δ≈0.024), S2 fail (ATS≈0.257) | **Stop extending** |
| Name-heuristic FCS | Polluted “M3 true” | Replaced by verified IDs — **keep** |

A rebuild is **not** an automatic pass. New code must clear the **same locked criteria** ([`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md)) market-by-market. Closes remain **evaluation-only**.

---

## 1. Non-negotiables (ops + product)

| Rule | State |
|------|--------|
| Live NFL / Coach product sim | Untouched — stamp stays `ppg-per-drive-v1` |
| Research activation | New stamp only, opt-in env / context flag (never default) |
| Gate | `NCAAF_GAME_LINE_SIM_VALIDATED = false` until human E6 |
| FINAL_EVAL fixtures | **UNTOUCHED** until a candidate is locked on TUNING screen |
| Closing odds | Join for M3/S2/CLV only — **forbidden** in features / training loss |
| Paid Odds retrieval | **Not authorized** this design turn |
| Deploy / OTA / voice | Freeze armed · no publish · voice paused |
| FBS–FCS | Unsupported scope → explicit withhold (not scored as fail/pass) |

---

## 2. What we reuse vs abandon

### Reuse (frozen assets / protocols)

| Asset | Why |
|-------|-----|
| Season-specific ESPN FBS/FCS IDs | `ncaaf-subdivision-espn-ids.json` + `ncaafSubdivision.ts` |
| FBS–FCS / unrated withhold | Protocol in `ncaafTeamStrengthSupport.ts` (semantics; new engine owns its own support module) |
| TUNING games + closes | `ncaaf-tuning-2025-w1-7-games.json` (+ subdivision tags), closing-lines fixtures |
| Phase-E games / settlement audit convention | Cover: `homeScore + line > awayScore`; pushes `adj==0` excluded |
| Acceptance criteria M1–M4 / S1–S4 / C1–C6 / P1–P3 | Locked; do not edit after seeing scores |
| Eval harness patterns | Phase-E / TUNING scripts as **templates** — new scripts under clean stamp |

### Abandon as scoring path (keep as archive only)

| Module / stamp | Action |
|----------------|--------|
| `FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION` drive residual path | No new levers; do not bump |
| `FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION` / v0 | No new inputs on v0; archive |
| Drive gap-scale sweeps / blend retunes | Closed unsuccessful |

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  RESEARCH ONLY — stamp: ncaaf-score-margin-v1-research (frozen)  │
│  Flag: ncaafCleanEngineResearch / NCAAF_CLEAN_ENGINE_RESEARCH=1 │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────┐     ┌──────────────────────────────────┐
│ GameRow contract     │────▶│ Feature assembly (pregame only)  │
│ (identity + venue +  │     │ Missing → explicit MissingInput  │
│  schedule context)   │     └──────────────────────────────────┘
└──────────────────────┘                      │
                │                             ▼
                │              ┌──────────────────────────────────┐
                │              │ Strength state (chronological)  │
                │              │ offense μ, defense μ, SOS, n    │
                │              └──────────────────────────────────┘
                │                             │
                ▼                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage A — generative core                                        │
│   P(home_score, away_score)  →  margin = home − away             │
│   Outputs: score joint (or equivalent margin+total factorization)│
└──────────────────────────────────────────────────────────────────┘
                │
        ┌───────┼───────────────┐
        ▼       ▼               ▼
   Stage B   Stage C         Stage D (later)
   Moneyline Spread/ATS      Total  →  ALT (only if validated)
   settle    settle+push     settle
```

**Isolation boundary:** all new types/modules live under  
`artifacts/api-server/src/lib/sportSim/ncaafClean/` (proposed).  
`nflDriveSim.ts` / mobile Coach must **not** import this package unless behind the research flag **and** college-only. Prefer offline scripts + unit tests until Stage B clears TUNING screen.

---

## 4. Data contract

### 4.1 Team identity (season-specific)

```ts
type TeamId = string; // ESPN team id as string

type SeasonTeamIdentity = {
  teamId: TeamId;
  season: number;           // competition year (e.g. 2025)
  displayName: string;
  subdivision: "fbs" | "fcs" | "unknown";  // from verified fixture only
  conferenceId?: string | null;
  transition?: "fcs_to_fbs" | "fbs_to_fcs" | null;
};
```

**Rules**

- Identity is `(teamId, season)` — never reuse prior-season subdivision.  
- `unknown` → matchup scope `involves_unknown` → **withhold** (do not invent FBS).  
- Transitions (Delaware/Missouri State 2025) come only from the verified ID fixture.

### 4.2 Game row (pregame + postgame split)

```ts
type CleanGamePregame = {
  eventId: string;
  season: number;
  week?: number | null;
  kickoffIso: string;
  home: SeasonTeamIdentity;
  away: SeasonTeamIdentity;
  venue: {
    kind: "home" | "neutral" | "unknown";
    neutralReason?: "bowl" | "conference_championship" | "neutral_site" | "unspecified";
    venueId?: string | null;
  };
  rest: {
    homeDaysRest: number | null;  // null if prior kickoff unknown
    awayDaysRest: number | null;
  };
  matchupScope: "fbs_fbs" | "fbs_fcs" | "fcs_fcs" | "involves_unknown";
};

type CleanGameResult = {
  eventId: string;
  homeScore: number;
  awayScore: number;
  decided: boolean; // false if cancelled / no final
};

/** Eval-only — never in feature vectors */
type CleanGameCloses = {
  eventId: string;
  closeMlHome?: number | null;
  closeMlAway?: number | null;
  closeSpreadHome?: number | null;
  closeTotal?: number | null;
  closeSnapshotTimestamp?: string | null;
};
```

### 4.3 Strength / schedule state (built chronologically)

```ts
type TeamStrengthState = {
  teamId: TeamId;
  season: number;
  nFbsGames: number;           // completed FBS–FBS only
  offMu: number | null;        // expected points vs average FBS defense; null if unrated
  defMu: number | null;        // expected points allowed vs average FBS offense
  sosOff: number | null;       // opponent-adjusted schedule strength (offense faced)
  sosDef: number | null;
  uncertainty: number;         // ≥0; high early season / low n (explicit, not silent prior)
  lastUpdatedKickoffIso: string | null;
};

type MissingInput =
  | "unrated_fbs_side"
  | "fbs_fcs_unsupported_scope"
  | "involves_unknown_subdivision"
  | "venue_unknown_material"
  | "injury_unavailable"
  | "qb_availability_unavailable"
  | "insufficient_history";
```

**Opponent adjustment:** ratings update only from completed games whose `matchupScope === "fbs_fbs"`. FBS–FCS never writes into FBS μ (withhold those rows for product; optional separate diagnostics later).

**Early-season uncertainty:** `uncertainty` is a first-class field (e.g. function of `nFbsGames` and days into season). Predictions must widen score/margin variance when uncertainty is high — **not** invent a fixed “default 24 PPG” μ for unrated teams. Unrated → `offMu/defMu = null` → prediction returns `MissingInput`.

### 4.4 Venue

| `venue.kind` | HFA treatment |
|--------------|---------------|
| `home` | Apply declared home-field offset (locked before TUNING screen of that candidate) |
| `neutral` | HFA = 0 |
| `unknown` | **Frozen:** keep `unknown`; attempt recovery; if unresolved → `evaluableSupported=false` + `venue_unknown_material`. HFA **not applied** (≠ rewriting to neutral). |

Source: ESPN competition/venue fields when present on game rows (free). Current TUNING/phase-e fixtures lack venue fields → **data blocker** until recovered.

### 4.5 Injury / availability (supported inputs)

```ts
type AvailabilityInput = {
  eventId: string;
  captureTimestamp: string; // must be < kickoffIso
  home: {
    qbStatus: "active" | "out" | "doubtful" | "unknown";
    keyOffenseOut: boolean | null;  // null = unknown, never coerce to false
    keyDefenseOut: boolean | null;
  };
  away: { /* same shape */ };
};
```

**Rules (from E4 / historical availability doc)**

- Only snapshots with `captureTimestamp < kickoff`.  
- Historical 2024/2025 injury columns that are all-null stay **unavailable** — do not backfill from live ESPN.  
- Forward collector may populate **future** slates; TUNING screen may run with `injury_unavailable` explicit.  
- Missing injury is **not** imputed from closes or from post-game box scores.

### 4.6 Prediction output contract

```ts
type CleanEnginePrediction = {
  stamp: "ncaaf-score-margin-v1-research";
  eventId: string;
  ok: true;
  evaluableSupported: boolean; // research eval inputs ok — NOT production approval
  productionReleaseApproved: false;
  // Stage A
  homeScoreMean: number;
  awayScoreMean: number;
  marginMean: number;          // home − away
  marginSd: number;
  totalMean: number;
  totalSd: number;
  hfaApplied: boolean;         // true only when venue.kind === "home"
  uncertainty: number;
  featuresUsed: string[];
  missingOptional: MissingInput[]; // e.g. injury_unavailable; does not invent adjustment
} | {
  stamp: "ncaaf-score-margin-v1-research";
  eventId: string;
  ok: false;
  evaluableSupported: false;
  productionReleaseApproved: false;
  reason: MissingInput;
};
```

Market probabilities (Stage B+) are **derived** from the score/margin distribution — never a separate ad-hoc ML logit that ignores the generative core.

---

## 5. Market derivation & settlement

Reuse Phase-E settlement conventions (already unit-checked):

| Market | Probability | Settlement |
|--------|-------------|------------|
| **ML** | `P(homeScore > awayScore)` under OT-inclusive two-way finals | Historical ties/invalid → **exclude + report**; **no** half-wins. `y = 1{home > away}` |
| **Spread / ATS** | `P(homeScore + closeSpreadHome > awayScore)` for eval at close line | Cover if `homeScore + line > awayScore`; **push if adj==0** → exclude from Brier |
| **Total** | `P(homeScore + awayScore > closeTotal)` | Over/under/push analog; requires `closeTotal` archive |
| **ALT** | Same settlement at alternate line | Only after main markets validated; requires posted ALT prices |

**S3** (settlement audit CLEARED) must pass on the clean stamp before any ATS PASS claim.

Closes (`CleanGameCloses`) attach **only** in scoring scripts, never inside `predict()`.

---

## 6. Evaluation protocol (unchanged thresholds)

| Split | Window | Role |
|-------|--------|------|
| **TUNING** | 2025 w1–7 | Screening / nested week folds / candidate lock only |
| **FINAL_EVAL** | 2025 w8+ (+ completed 2026 when built) | Single acceptance run — **empty until lock** |

### Candidate lock checklist (before touching FINAL_EVAL)

1. Stamp + feature protocol + HFA + uncertainty function **written down** (no close-fitted constants).  
2. TUNING nested folds select **one** candidate (score-only + close-joined M3/S2 as screen — not independent proof).  
3. Identical-event scorecard vs locked drive archive and vs v0 archive for regression visibility (optional, not a pass condition).  
4. Human acknowledge lock doc.  
5. **Then** build FINAL_EVAL once and score once.

### Market-specific readiness

| Market | Ready when |
|--------|------------|
| ML | M1–M4 on FINAL_EVAL |
| Spreads | S1–S4 on FINAL_EVAL |
| Totals | Totals gate + closeTotal present; else `INSUFFICIENT_DATA` |
| ALTs | Posted ALT prices + validation; else `INSUFFICIENT_DATA` |
| Coach CLV | C1–C6 after engine markets justified |

**P3:** No market enabled solely because another passes.

---

## 7. Implementation milestones

Review gate between milestones — do not skip ahead into ALT or FINAL_EVAL.

### M0 — Design freeze (this document)

**Exit:** **DONE** — decisions § frozen table above.

### M1 — Skeleton + isolation

| Deliverable | Notes |
|-------------|-------|
| Package `sportSim/ncaafClean/` | **DONE** |
| Unit tests | **DONE** (`test/ncaafClean.m1m2.test.ts`) |
| Prove | Live stamp unchanged; gate false; no product imports of `ncaafClean` |

### M2 — Stage A generative core (score / margin)

| Deliverable | Notes |
|-------------|-------|
| Chronological FBS–FBS rating update | **DONE** (`CleanOppAdjStrength`) |
| Uncertainty from `nFbsGames` | **DONE** |
| Venue protocol | unknown → no HFA + `evaluableSupported=false`; neutral → HFA 0; home → HFA |
| Settlement helpers | **DONE** (ML tie exclude; ATS/total push) |
| Score-only TUNING report | **DONE** — [`ncaaf-clean-m2-report.md`](./ncaaf-clean-m2-report.md) |

**Exit for M2:** Score-only diagnostics + settlement plumbing ready; **not** a restore claim.  
**Venue sidecar:** [`ncaaf-clean-venue-recovery.md`](./ncaaf-clean-venue-recovery.md) — 471/471 recovered (465 home, 6 neutral incl. 1 international).

### M3 — Stage B moneyline + Stage C spreads

| Deliverable | Notes |
|-------------|-------|
| Derive ML + ATS from Stage A | **DONE** (analytic Normal CDF) |
| TUNING close-joined screen | **DONE** — [`ncaaf-clean-m2-m3-screen.md`](./ncaaf-clean-m2-m3-screen.md) |
| Result (screen only) | Overall M3 **FAIL** (Δ≈0.021); S2 **FAIL** (ATS≈0.260). Not a restore. |
| Nested week folds / lock | Not yet — screen fails locked thresholds |

**Exit for M3:** Either “candidate locked for FINAL_EVAL” or “return to M2 features” — never unlock product. **Current:** return to feature work; do **not** build FINAL_EVAL.

### M4 — FINAL_EVAL (once)

| Deliverable | Notes |
|-------------|-------|
| Build FINAL_EVAL fixtures | ESPN + eval-only closes when authorized |
| Score once | Market-specific table vs M1–M4 / S1–S4 |
| Publish readiness | Supported FBS–FBS only; FBS–FCS withhold counts separate |

### M5 — Totals (conditional)

Requires `closeTotal` archive (paid Odds historically — **separate approval**). Until then report `INSUFFICIENT_DATA`.

### M6 — ALT (conditional)

Only after ML + ATS FINAL_EVAL path is credible **and** posted ALT prices exist. Synthetic ALT ladders ≠ CLV validation.

### M7 — Product gate (human E6 only)

Flag-only PR to flip `NCAAF_GAME_LINE_SIM_VALIDATED` — out of scope until M4 passes. Voice stays paused; OTA/deploy unrelated.

---

## 8. Suggested first code surfaces (when M0 approved)

```
artifacts/api-server/src/lib/sportSim/ncaafClean/
  types.ts
  stamp.ts                 # ncaaf-score-margin-v1-research
  identity.ts              # wraps ncaafSubdivision
  features.ts              # venue, rest, missing inputs
  strength.ts              # chronological opp-adj state
  predictScoreMargin.ts    # Stage A
  markets.ts               # Stage B/C derivation + settlement helpers
  support.ts               # withhold reasons → Coach-facing codes (research scripts only)

artifacts/api-server/test/ncaafClean*.test.ts
artifacts/api-server/scripts/ncaafCleanTuningScreen.ts
```

**Do not** modify `coachP0UnvalidatedTotals.ts` gate.  
**Do not** wire mobile Coach to the clean stamp in M1–M3.

---

## 9. Explicit non-actions this design authorizes

- No extension of drive residual/shrink or team-strength v0  
- No FINAL_EVAL build or peek  
- No Odds purchase / historical refetch  
- No deploy, OTA, production publish  
- No NCAAF unlock / gate flip  
- No voice resume  
- No criteria edits after seeing scores  
- No treating FBS–FCS withhold volume as model success or failure  

---

## 10. Review questions

**Resolved** (frozen decisions table). Next gate: M2 report + data blockers before M3.

---

## 11. Pointers

| Doc | Role |
|-----|------|
| [`ncaaf-restoration-attempt-closed-334.md`](./ncaaf-restoration-attempt-closed-334.md) | Why drive/v0 closed |
| [`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md) | Locked M/S/C/P |
| [`ncaaf-engine-isolation.md`](./ncaaf-engine-isolation.md) | Live vs research stamps |
| [`ncaaf-historical-data-availability.md`](./ncaaf-historical-data-availability.md) | Injury/totals/ALT gaps |
| [`ncaaf-team-strength-next-inputs-proposal.md`](./ncaaf-team-strength-next-inputs-proposal.md) | Inputs absorbed into §4 (no v0 extension) |

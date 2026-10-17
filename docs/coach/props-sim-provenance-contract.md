# Props simulation provenance contract (Issue B)

**Status:** Findings + proposed contract for review. **No eligibility-policy implementation in this PR.**  
**Trigger:** Sedrick Alexander Anytime TD (−120) cleared #711 on a historical binary model while exact-key deep 10k returned `stat_mapping_failed`.  
**Baselines preserved:** confidence ≥ 52, grade ≥ C+, sport scope, provider odds, native compatibility.

---

## 1. Answers to audit questions

### Q1 — Is historical-model-only evidence intentionally eligible under the existing qualification contract?

**Yes — intentionally eligible today.**

| Layer | Behavior |
|-------|----------|
| Props-only ticket | `gradeFootballPropsOnlyFromHistory` first; deep MC only for still-null keys; **never overwrites** a local history hit (`coachFootballPropsOnlyTicket.ts` ~700–748) |
| #711 | `evaluateCoachQualification` requires finite `simHit` via `pickHasSimGrade` — **does not** require `simulations === 10000` or a deep-tier source (`qualifyCoachCandidate.ts`) |
| ATD model | `anytimeTdHitFromValues` / `gradeFootballPropFromHistory` produce a real hit + reliability from game logs |

Sedrick: history → hit **0.572** / rel **0.6** → qualifies at conf 52 / grade B / edge +0.6 after tilt. That is floor-eligible under the current contract, not a below-floor smuggle.

### Q2 — Do UI/API claims incorrectly describe history hits as 10k-backed?

**Yes — labeling mismatch (display / holistic factor).**

| Surface | Claim | Actual for Sedrick |
|---------|-------|--------------------|
| `propHolisticRecommendation.ts` factor | label **`"10k Simulation"`** whenever `simHit != null` | History-model hit, not 10k MC |
| Factor display | `"${pct}% hit"` | Same probability, wrong engine name |
| `ScoreBreakdown` detail bars | `"Model Sim"` (neutral) | OK |
| Deep API for exact key | `nullReason: stat_mapping_failed`, `simulations: 0` | Correct failure — not forged into success |
| Ticket path | Does not call deep when history already graded | Honest skip; label still says 10k |

**Do not** silently relabel or invent 10k results. Fix is source-aware labels + stored provenance.

### Q3 — Should market-specific sim failure block seating or allow labeled history fallback?

**Current:** allow history seating; deep failure is invisible when history already graded.  
**Proposed (for review — not implemented):**

| Option | Seating when deep fails | Label |
|--------|-------------------------|-------|
| **A (label-only)** | Keep history eligible (today’s #711) | Must say `Historical model` / never `10k Simulation` |
| **B (deep-required)** | Reject / leave ungraded if exact-key deep fails | No seat without `deep_mc_10k` |
| **C (hybrid — recommended)** | Allow history fallback only for allowlisted families (ATD / rare-count) with explicit source + reliability floor; otherwise fail closed | Source stamp required on card + qualify path |

Recommendation: **C**, with ATD/rare-count on the allowlist and yards/volume markets preferring deep when the board path would have requested it.

### Q4 — Are confidence, grade, and edge computed from the same probability source?

**Mostly yes on the props-only seating path; with one documented transform.**

1. Base `hit` from history (or deep if history null).  
2. `adjustSimHitForOppDefenseTilt(hit, tilt)` may move hit (±5 pts max).  
3. `edgePct = round((hit − implied) × 1000) / 10` from the **adjusted** hit.  
4. `buildFinalAiScore({ propSimHit: adjusted })` → holistic grade/confidence from that same `simHit`.

Sedrick display edge **+0.6%** ⇒ adjusted hit ≈ **0.551** (raw history 0.572 − mild negative tilt). Grade/confidence/edge share that adjusted probability; they do **not** use a separate deep hit (deep was null).

**UNVERIFIED:** exact handset `finalAiScore` dump at paint time (no device log). Rebuild is consistent with history+tilt+holistic.

### Q5 — Which other markets/sports share this provenance mismatch?

| Class | Examples | Why |
|-------|----------|-----|
| **Server mapping gap vs mobile** | NCAAF/NFL `player_anytime_td`, `player_first_td` | Mobile `propStats.gameValueForMarket` sums rush+rec+pass TDs; **server `propStatValue.ts` has no ATD/first-TD composite** → deep `stat_mapping_failed` while client history grades |
| **Props-only history-first path** | All football props-only seats (NFL + NCAAF yards, receptions, sacks, TDs) | Deep never consulted once history hits; holistic still labels **10k Simulation** |
| **Deep succeeds** | e.g. Junior Sherrill `player_reception_yds` alt (audit: 10k hit 0.96) | True deep provenance; label OK if source stamped |
| **Both fail** | Missing athleteId / no history / insufficient mapped stats | Correctly ungradable — must stay rejected |

Supported sports with the same **label** mismatch anywhere `buildPropHolisticScore` runs with a non-deep `simHit`: NFL, NCAAF, and any sport using that holistic builder for props.

---

## 2. Sedrick exact-key evidence (reconfirmed)

| Check | Result |
|-------|--------|
| Provider | FanDuel Yes/−120, athlete `5030333`, VAN `238`, ARK@VAN — **PASS** |
| Deep 10k | `stat_mapping_failed`, simulations 0 — **FAIL** (server mapping) |
| History model | 5/6 binary scores → shrunk **0.572**, rel **0.6** — **PASS** |
| #711 | conf 52 / B / edge +0.6 → qualified; 51 → confidence_floor — **PASS** (floor-eligible) |

Artifacts: `/opt/cursor/artifacts/handset-props-provenance-audit.md`, `audit-ncaaf-deep-sim.json`, `audit-hist-ncaaf-5030333.json`.

---

## 3. Proposed contract (review before implementation)

### 3.1 Provenance stamp (immutable after qualify)

```ts
type PropProbabilitySource =
  | "deep_mc_10k"      // exact player|market|line|side, simulations >= 10000, hit non-null
  | "history_model"    // client/server history grade (ATD shrink, empirical, rare-count, …)
  | "none";            // ungradable

type PropProbabilityProvenance = {
  source: PropProbabilitySource;
  hitProbability: number | null;
  simulations: number;           // 0 unless deep_mc_10k
  nullReason: string | null;     // deep/history failure code
  hitReliability: number | null; // history models
};
```

Rules:

- Never set `source: "deep_mc_10k"` unless exact-key deep succeeded.  
- Never overwrite a deep hit with history or vice versa without an explicit policy step.  
- `rejected` stamps stay terminal (`withCoachQualification`).

### 3.2 Display labels

| Source | Holistic / card simulation factor label |
|--------|----------------------------------------|
| `deep_mc_10k` | `10k Simulation` |
| `history_model` | `Historical model` (or `Game-log model`) |
| `none` | factor absent / not present |

### 3.3 Eligibility policy options (choose in review)

See Q3 table. **No code change until an option is approved.**

### 3.4 Server mapping fix (orthogonal, recommended)

Port mobile ATD/first-TD composite into `api-server` `propStatValue.gameValueForMarket` so deep can succeed. That restores true 10k for ATD; it is **not** a silent relabel of failed sims.

### 3.5 Regression cases to add after approval

1. Successful exact-market 10k → source `deep_mc_10k`, label `10k Simulation`, qualifies when #711 met.  
2. Failed 10k + valid history → source `history_model` (if Option A/C); label not 10k; #711 unchanged.  
3. Failed 10k + no authoritative fallback → ungraded / rejected; no invented hit.  
4. Missing stat mapping (`stat_mapping_failed`) → preserved on provenance; never shown as successful 10k.  
5. Correct model-source labels for both sources.  
6. Rejected candidates stay rejected (no promotion).

Characterization tests for **current** behavior land in this PR; proposed-label/policy tests stay `todo` until Option A/B/C is chosen.

---

## 4. Out of scope for this PR

- Changing #711 floors or sport scope  
- Unlocking P0 NCAAF game lines  
- Implementing Option B/C seating gates  
- OTA / merge / deploy / build  
- Silently synthesizing 10k results from history

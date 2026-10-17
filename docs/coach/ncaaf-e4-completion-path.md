# E4 completion path — frozen M_base + prospective injury evidence

**Locked:** 2026-10-17 · branch `cursor/ncaaf-final-eval-ml-archive-3645`  
**Frozen score preserved:** yes — `ncaaf-score-margin-v1-research` α=1.15, nMl=403 (see [`ncaaf-final-eval-frozen-score.md`](./ncaaf-final-eval-frozen-score.md))  
**This turn:** docs / protocol only — **no purchase · no collector activation · no deploy · no OTA · no gate change**  
**E6:** not requested (`e4Resolved` remains false)

---

## 0. Verdict — fastest defensible path

| Rank | Path | Purchase now? | Unlocks historical TUNING / FINAL_EVAL injury joins? | Expected evidence duration |
|------|------|:-------------:|:----------------------------------------------------:|----------------------------|
| **1 (default)** | **Forward ESPN freezes + prospective eval** (collector already prepared; inactive) | No | No — future Odds-listed FBS only | **~3–6 weeks** in-season to hit locked n (see §4); ~2–3 weekends if nulls are pre-scheduled |
| **2 (parallel, $0)** | **ScoreTape Explorer sample verify** (free key, 7-day window) | No ($0 Explorer) | No — schema / provenance only | **Same day–1 business day** after free key |
| **3 (conditional)** | ScoreTape Desk / sales dump **only after** Explorer sample proves CFB `captured_ms` as-of ≤ kickoff | Human decision later | **Only if** archive depth covers the target kickoffs (unproven until sample + Desk window checked) | Days after purchase (not authorized) |
| **Blocked** | SportsDataIO Vault / box-score `InjuryStatus` | Do not purchase | Timing **not** E4-proven (game-start claim without as-of trail) | N/A until written guarantee |

**Recommendation:** Keep M_base frozen. Run Path 2 (free sample) in parallel with preparing Path 1. Do **not** buy Desk / SportsDataIO until Explorer (or written sales sample) shows CFB rows with `captured_ms` reconstructable at T &lt; kickoff for real games. If historical depth fails that check, Path 1 is the completion path.

---

## 1. Provider verification (docs + public pricing — no key, no purchase)

### 1.1 ScoreTape — timestamped injury change-log (best timing shape)

| Item | Finding |
|------|---------|
| Endpoint | `GET /v1/cfb/injuries` (league code `cfb`) |
| Timing shape | One row per status change; reconstruct as-of T by latest row with `captured_ms ≤ T` ([docs](https://scoretape.com/docs)) |
| Provenance | Independent aggregator; CFB listed with **Injuries (live)**; polls league-wide reports ~60s; game docs can attach injury change-log “up to start + 24h” |
| Sample availability **before paid** | **Explorer $0** — 7-day unified history, 1 req/s, REST; free key “same day”; sufficient to inspect CFB payload + `captured_ms` |
| Cost (list, 2026-10-17) | Explorer **$0** (7d) · Quant **$29/mo** (30d) · Desk Lite **$79/mo** (90d) · Desk **$200/mo** (full archive) |
| Holdout backfill risk | Plan history window gates all layers. Desk “full archive” = full **captured** archive — **does not guarantee** coverage of 2025 TUNING / FINAL_EVAL kickoffs if CFB injury capture started later. Must verify `since=` / game slug depth on sample before any paid upgrade |
| Purchase gate | **Do not purchase** until Explorer (or sales sample) shows: (a) CFB rows with finite `captured_ms`, (b) as-of T &lt; kickoff yields a stable report, (c) at least one Odds-listed FBS game joinable by team/kickoff |

**Pre-purchase sample checklist (human / later agent with free key only)**

1. Request Explorer key ($0) — not done this turn.  
2. `GET /v1/cfb/injuries?since=<today-6d>` — confirm non-empty `captured_ms`, status, athlete, team.  
3. Pick one upcoming or just-played FBS game; reconstruct report at T = kickoff − 1h; assert all used rows have `captured_ms < kickoff`.  
4. Record earliest `captured_ms` in window → infer whether Desk could reach FINAL_EVAL dates.  
5. Stop. Escalate to human only if (1)–(4) pass and historical depth looks sufficient.

### 1.2 SportsDataIO — claimed game-start snapshot, timing unproven

| Item | Finding |
|------|---------|
| Claim | Historical injuries inside box scores as status at **game start**; `PlayerGame.InjuryStatus` from **2018** ([Historical Data Integration Guide](https://sportsdata.io/help/historical-data-integration-guide)) |
| Gap | Archive **does not** support as-of-time reconstruction; Final box scores after completion; in-game injuries added **post-game**; no published `InjuryStatusAsOf` / pre-kick timestamp |
| Cost | Commercial / Vault — **sales-quoted** (not self-serve list for CFB historical injuries); Discovery Lab personal tiers exist but are not an E4 timing proof |
| Purchase gate | **Do not purchase** until written guarantee or sample payload proves immutability from game start / lineup lock for that `GameID` (see [`ncaaf-e4-injury-provider.md`](./ncaaf-e4-injury-provider.md)) |

### 1.3 Ruled out for historical E4

| Provider | Why |
|----------|-----|
| ESPN public | Live `/injuries` only; no holdout archive |
| CFBD | No injury family |
| The Odds API | Odds/scores only |

---

## 2. Forward snapshot collection (prepared — not activated)

| Artifact | Role | Status |
|----------|------|--------|
| `scripts/ncaafPregameInjurySnapshotCollector.ts` | Freeze ESPN CFB injuries + `captureTimestamp` | **INACTIVE** until `NCAAF_INJURY_COLLECTOR_ACTIVE=1` |
| `test/fixtures/ncaaf-pregame-injury-snapshots/` | Forward evidence store | 1 freeze (2026-10-16); must not backfill past holdouts |
| Join | `joinE4Labels` / `classifyAvailabilitySnapshot` in `e4Availability.ts` | Usable only when `captureTimestamp < kickoffIso` |
| Cost | ESPN public | **$0** |

**Activation is out of scope this turn.** When a human authorizes activation later:

1. Cron / runner: ≥2×/day Mon–Thu; ≥4× Fri–Sun around tip windows (align with [`ncaaf-forward-collection-plan.md`](./ncaaf-forward-collection-plan.md) ESPN row — 14 freezes/week model).  
2. For each Odds-listed FBS kickoff, keep the latest freeze with `captureTimestamp < kickoffIso` (else label null).  
3. Never rewrite labels after kickoff. Never join current freezes into 2024/2025 holdout rows.  
4. Pair with existing / future close-ML joins for edge computation (Odds credits separate; injury freezes remain $0).

---

## 3. Prospective evaluation protocol (if historical archive fails or is not bought)

Use when Path 1 is the evidence source (default).

### 3.1 Pre-registration (before any segment numbers)

Lock all of §4 **before** computing mean \|edge\| or pass/fail. Write prospective membership IDs to a fixture when collection starts; do not edit thresholds after seeing results.

### 3.2 Cohort construction

| Step | Rule |
|------|------|
| Universe | Odds-listed FBS only (same competition scope as ML FINAL_EVAL) |
| Decision | Final score known; two-sided close ML present (same M1 join rules as frozen harness) |
| `injuryKnown=true` | Usable pre-kick freeze joined (`captureTimestamp < kickoffIso`) |
| `injuryKnown=null` | No usable pre-kick freeze — **including** games **pre-scheduled** into a no-capture holdout |
| Null construction | Prefer **scheduled non-capture** (e.g. pre-declared 25–35% of slate IDs skipped before week starts) so null ≠ “failed because edge looked bad.” Operational misses allowed if logged before results review |
| Forbidden | Backfill from live ESPN after kickoff; coerce null→false; drop games after seeing edges |

### 3.3 Two evaluations (do not mix)

| Eval | Model | Labels | When scored |
|------|-------|--------|-------------|
| **E4-seg** | Edges from **M_base** (no injury adjust) stratified by joined labels | `injuryKnown` true\|null | After §4 n met — coverage/selection conservatism |
| **E4-inj** | Edges from **M_inj** = M_base + `e4ConservativeAdjust` on usable snaps only | Same joins | **Independent** prospective pass; not the frozen FINAL_EVAL score |

Synthetic behavioral tests (`ncaafClean.e4Availability.test.ts`) stay **non-predictive**.

### 3.4 Stopping rule

Stop collection for E4-seg when §4 sample floors are met **and** results are final for those games. Do not peek at segment means until the membership file is frozen.

---

## 4. Locked sample / segment criteria (before examining results)

**Status: LOCKED 2026-10-17 — do not edit after seeing prospective numbers.**

### 4.1 Sample floors

| ID | Criterion | Threshold |
|----|-----------|-----------|
| N1 | Odds-listed FBS games with decided outcome + close ML + E4 join attempt | `n ≥ 60` |
| N2 | `injuryKnown=true` (usable pre-kick join) | `nKnown ≥ 20` |
| N3 | `injuryKnown=null` | `nNull ≥ 20` |
| N4 | Side mix on scored set | home ≥ 15 and away ≥ 15 |
| N5 | Capture rule | Every `true` row has `captureTimestamp < kickoffIso` (ISO parse finite) |
| N6 | Coercion | Zero rows with null coerced to false; `false` injuryKnown forbidden |

### 4.2 Segment conservatism (E4 R3)

| ID | Criterion | Threshold |
|----|-----------|-----------|
| S1 | Mean absolute engine edge | `mean\|edge\|_null ≤ mean\|edge\|_known` |
| S2 | Edge definition | Same probability-point edge as ML harness (engine vs close), per game |
| S3 | Insufficient | If N2 or N3 unmet → `INSUFFICIENT_DATA` (not PASS, not FAIL) |

### 4.3 Scope / process holds

| ID | Rule |
|----|------|
| P1 | Spreads / totals / ALTs remain blocked |
| P2 | `NCAAF_GAME_LINE_SIM_VALIDATED=false` until human E6 after E4 resolved |
| P3 | No retune of M_base on prospective injury window |
| P4 | No purchase solely on unverified archive timing claims |

Machine-readable copy: `artifacts/api-server/test/fixtures/ncaaf-e4-completion-path-criteria.json`.

---

## 5. Model separation

| ID | Definition | Validation status | Fresh independent eval required? |
|----|------------|-------------------|:--------------------------------:|
| **M_base** | Clean E1 α=1.15 score-margin research stamp; **no** injury features / adjusts | FINAL_EVAL frozen once: M1–M4 + C1–C6 **true**; `finalPass=false` only on E4 product gate | **No** for ML metrics already measured. Do not rescore FINAL_EVAL. E4-seg (optional diagnostic) may use M_base edges + new labels only |
| **M_inj** | M_base + `e4ConservativeAdjust` / `E4_POLICY` when `usable_pre_kick` | Behavioral policy tests only — **not** historically validated | **Yes** — prospective E4-inj on §4 sample; cannot inherit frozen FINAL_EVAL pass bits |

**Product rule:** E4 historical/prospective predictive validation is **open** until R1–R3 clear on real joins. Clearing E4-seg on M_base labels does **not** authorize shipping M_inj. Shipping / gate flip still needs E6 and remains out of scope here.

```
M_base (frozen FINAL_EVAL) ──► ML metrics done; injuryKnown was null everywhere
         │
         ├── E4 joins (forward or verified archive)
         │      ├── E4-seg on M_base edges     → R3 coverage check
         │      └── E4-inj on M_inj edges      → fresh eval (required for injury adjust)
         └── Gate / E6 / OTA                   → not this turn
```

---

## 6. Duration summary

| Work | Calendar (in-season, Oct–Nov 2026) | Cost |
|------|-------------------------------------|------|
| ScoreTape Explorer sample verify | 0–1 day after free key | $0 |
| Forward freezes to N1–N3 (typical) | **3–6 weeks** (≈3–6 FBS weekends) | $0 ESPN |
| Forward freezes aggressive (pre-scheduled nulls + dense Fri–Sun snaps) | **~2–3 weeks** | $0 ESPN |
| ScoreTape Desk historical (only if sample proves depth) | Days after purchase | $200/mo list — **not authorized** |
| SportsDataIO | Blocked on timing letter | Sales quote — **not authorized** |

**Fastest defensible completion without purchase:** activate forward collector (later) + lock membership → collect **~3–6 weeks** → score E4-seg then E4-inj under §4 → keep M_base frozen throughout.

---

## 7. Explicit non-actions (this turn)

- No ScoreTape / SportsDataIO purchase or key activation  
- No `NCAAF_INJURY_COLLECTOR_ACTIVE`  
- No deploy / OTA / `NCAAF_GAME_LINE_SIM_VALIDATED` flip  
- No E6 request  
- No FINAL_EVAL rescore or retune  

## 8. Cross-links

- Provider detail: [`ncaaf-e4-injury-provider.md`](./ncaaf-e4-injury-provider.md)  
- Status audit: [`ncaaf-e4-status.md`](./ncaaf-e4-status.md)  
- Frozen score: [`ncaaf-final-eval-frozen-score.md`](./ncaaf-final-eval-frozen-score.md)  
- Release review: [`ncaaf-ml-only-release-review.md`](./ncaaf-ml-only-release-review.md)  
- Forward odds plan: [`ncaaf-forward-collection-plan.md`](./ncaaf-forward-collection-plan.md)  

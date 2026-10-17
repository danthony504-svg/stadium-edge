# Props simulation provenance contract (Issue B → Option C)

**Status:** Implemented (Option C hybrid allowlist + trusted exact-market evidence).  
**Related:** PR #772 landed findings/proposed contract on main; this document incorporates those findings and the implementation updates from Option C. PR #771 is separate NCAAF P0 messaging.  
**Baselines preserved:** confidence ≥ 52, grade ≥ C+, sport scope (#769/#770), provider odds, athlete identities, market lines, native/passkey startup. No invented hits. No extra API requests or simulation batches.

---

## 1. Findings (from #772 audit — preserved)

Sedrick Alexander Anytime TD (−120) cleared #711 on a historical binary model while exact-key deep 10k returned `stat_mapping_failed`. Holistic UI mislabeled history as “10k Simulation”. History-model-only was intentionally #711-eligible before Option C.

---

## 2. Provenance values (implemented)

```ts
type PropProbabilitySource =
  | "exact_market_10k"           // trusted 10k sims for exact athlete/event/market/side/line
  | "validated_historical_model" // only allowlisted sport+market with evidence
  | "insufficient_evidence";     // failed / unmapped / unapproved — not seating-eligible
```

### Exact-market identity (required)

`exact_market_10k` binds to **athleteId + eventId + market + side + exact line**.  
The legacy `player|market|line|side` map key must not authorize seating across different events/athletes.

Missing authoritative identifiers → fail closed (`missing_exact_identity`); coverage impact counters record the gap (`getExactMarketCoverageImpact()`).

### Trusted evidence (anti-forgery)

Caller-created `{ source: "exact_market_10k", simulations: 10000 }` objects never authorize seating.  
Only `exactMarket10kProvenance()` mints an `evidenceId` into a module-private registry. Qualification validates source, candidate identity, completed run count, and integrity against that registry.

### Stale `qualificationStatus: "qualified"`

Attached `qualified` still skips recompute of grade/confidence/edge, but **always re-validates prop provenance** before seating.

### ALT labels

PickCard caption uses `altLadderSimulationCaption` — claims “10K Simulation” only when every displayed alt line has verified exact-market evidence.

---

## 3. Eligibility

| Source | Seating | Holistic / card label |
|--------|---------|------------------------|
| `exact_market_10k` | Yes, when trusted evidence matches candidate identity | `10K Simulation` |
| `validated_historical_model` | Yes, only if sport+market is on allowlist | `Historical Model` |
| `insufficient_evidence` | **Never** | No simulation success label |

**Allowlist starts EMPTY** — no auto-approve NFL/NCAAF Anytime TD, first TD, or other markets.

---

## 4. Before / after (Sedrick ATD)

| | Before Option C | After |
|--|-----------------|-------|
| History hit 0.572 | #711 qualified; label “10k Simulation” | `insufficient_sim_provenance`; no success sim label |
| Forged exact stamp | would seat | rejected |
| Stale `qualified` + bad provenance | could seat | rejected |
| ALT chrome “10k sim” | always | only with verified per-line evidence |

---

## 5. Orthogonal follow-ups

- Server `propStatValue` ATD/first-TD composite so deep can succeed.
- Populate historical allowlist only with empirical evidence.
- P0 NCAAF messaging remains PR #771.

# Closing-Line Archive — Design (not enabled)

**Purpose:** Persist permissioned pre-game / closing odds for market-implied baselines, CLV, and Simulator V2 calibration benchmarking.  
**Status:** Design only. No production ingest, no Coach wiring, no OTA.  
**Constraint:** Respect Odds API (and any other provider) terms — storage, redistribution, and retention must be approved before implementation.

## 1. Problem

Chrono OOS today grades model probabilities against outcomes on **grid lines**, not true closing books. ESPN historical scoreboards leave odds arrays empty post-game. Without a closing-line archive:

- Market-implied ECE/Brier baselines are missing.
- CLV and “beat the close” diagnostics cannot be honest.
- Alt ladders cannot be snapshotted at a stable pre-tip timestamp.

## 2. Scope

| In scope | Out of scope (v1 design) |
|----------|---------------------------|
| Event identity + sport + commence time | Redistributing odds to clients |
| Book, market key, side, line, American odds | Using archive to invent V2 probs |
| Capture timestamps (listed, last, close) | Enabling `SIM_V2_SERVE` |
| Hash of raw provider payload (audit) | Storing full book HTML scrapes |
| Retention policy hooks | Training on post-start lines (leakage) |

## 3. Proposed schema (TypeScript sketch)

```typescript
// src/archive/closingLineSchemas.ts  (future — not wired)
type ClosingLineSnapshot = {
  snapshotId: string;
  eventId: string;           // canonical Stadium / Odds event id
  sport: string;
  provider: "the-odds-api" | "bovada" | "manual";
  providerEventId: string;
  book: string;
  marketKey: string;         // e.g. spreads, player_points_alternate
  period: string;            // fg|q1|...
  side?: string;
  line?: number;
  american: number;
  playerId?: string;
  capturedAt: string;        // ISO
  phase: "open" | "mid" | "close" | "pre_start_final";
  commenceTime: string;
  /** Minutes before commence when captured (negative = after start → reject for calib). */
  minutesToStart: number;
  payloadSha256: string;
  licenseTag: string;        // e.g. odds-api-tos-2026-q1
};
```

Settlement join key: `(eventId, marketKey, period, side, line?, playerId?)` + nearest `phase=close` with `minutesToStart ∈ [0, 30]` (configurable).

## 4. Capture pipeline (future)

```
Odds poller (existing api-server cadence)
    │  only if ARCHIVE_CLOSING_LINES=1 AND licenseTag present
    ▼
Validate minutesToStart > 0 (drop in-play for close archive)
    ▼
Upsert snapshot (dedupe book+market+line)
    ▼
At commenceTime + ε: freeze "close" row (last eligible pre-start)
    ▼
Cold storage (DB table or object store) with retention job
```

**Permissions gate:** env `CLOSING_LINE_ARCHIVE_LICENSE_OK=1` required; default off. Document which plan tier allows historical storage.

## 5. Use in V2 calibration

1. Load holdout events with outcomes.
2. Attach closing implied probs (`impliedProbFromAmerican`) as **baseline only**.
3. Report model ECE/Brier **and** (model − close) reliability; never replace missing close with fabricated lines.
4. If archive miss rate > threshold, mark market-implied slice `insufficient_data` (fail closed for that comparison, not for outcome calibration).

## 6. Retention & privacy

| Policy | Default proposal |
|--------|------------------|
| Hot retention | 90 days |
| Cold retention | 2 seasons for accepted sports under eval |
| PII | None (no user bets in this archive) |
| Export | Internal eval only; no public dump |
| Delete | Honor provider termination / user legal requests via `licenseTag` batches |

## 7. Branch & tests

- Branch: `cursor/sim-v2-cl-archive-*-def8`
- Unit tests: schema parse; reject `minutesToStart < 0` for close phase; dedupe; join to synthetic outcomes.
- Integration: dry-run against fixture JSON — **no live Odds writes** until license OK.
- Must not modify Coach CLV UX in the same PR as ingest (existing tracker CLV is separate).

## 8. Non-goals

- Scraping books that forbid archival.
- Using closing lines to auto-pass acceptance gates.
- Backfilling decades of history without a licensed historical product.

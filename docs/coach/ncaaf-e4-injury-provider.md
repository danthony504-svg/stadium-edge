# E4 — Historical pregame injury / QB availability

**Rule:** missing injury records are **not** “no injuries.” `injuryKnown` stays `null` until a documented **pre-kickoff** source fills it.

## Timing requirement (blocking)

E4 needs injury/QB availability that was knowable **before kickoff** for holdout games. A field that merely appears on a **completed** box score is insufficient unless the provider documents that the value is a frozen pre-kickoff (game-start) snapshot and not a post-game writeback.

## Provider verification (docs only — no subscription requested yet)

| Provider | Historical pregame injury/QB? | Timing evidence | Access |
|----------|-------------------------------|-----------------|--------|
| **ESPN** public APIs | **No** holdout archive | Live `/injuries` is current-season only; core historical injury URLs 404; summaries lack injury blocks | Public |
| **CFBD** | **No** | [Data availability](https://api.collegefootballdata.com/data-availability) has **no injury family** | N/A — do not request CFBD for E4 |
| **The Odds API** | **No** | Odds/scores only | Already used for E2b closes |
| **SportsDataIO CFB** | **Claimed, timing not proven for E4** | See below | Vault-enabled CFB stats key — **do not purchase until timing is confirmed** |

### SportsDataIO — what docs say vs what E4 needs

**Supportive claims**

- [Historical Data Integration Guide](https://sportsdata.io/help/historical-data-integration-guide): *“Players Feeds > Injuries: Historical injury data lives inside box scores, as a snapshot of each player's status at **game start**.”* Mid-week practice designations are **not** retained.
- Data dictionary: `PlayerGame.InjuryStatus` / body part / start date / notes **from 2018**.
- Endpoints: `BoxScoresFinal/{date}`, `BoxScoresByWeekFinal/{season}/{week}`.

**Timing gaps (why we do not request a subscription yet)**

1. The same Historical guide states the archive **does not support as-of-time reconstruction** and stores **outcomes / last revision**, not revision trails — so we cannot independently verify an InjuryStatus as-of T&lt;kickoff from the API alone.
2. NCAA Football workflow documents injury wires updated **through the week and leading up to games** on **live** player feeds; **Final** box-score endpoints are described as returning stats **after the game has been completed**, with post-final corrections possible.
3. In-game injuries are explicitly **added post-game** for the *upcoming* week — proving post-game mutation exists in the injury system. Docs do not publish a `InjuryStatusAsOf` / pre-kickoff timestamp on historical `PlayerGame` rows.
4. Therefore: “InjuryStatus present on a completed box score” ≠ proven “information known before kickoff” for that game. E4 remains blocked on **timing evidence**, not merely on lacking a key.

### What would unblock a SportsDataIO subscription request

Obtain **one** of the following in writing from SportsDataIO (or a sample payload that shows it):

- A field or guarantee that historical `PlayerGame.InjuryStatus` is immutable from game start / lineup lock and is never backfilled after kickoff for that `GameID`, **or**
- A historical pregame injury endpoint with an explicit as-of / snapshot timestamp ≤ kickoff, **or**
- A licensed frozen pregame dump (CSV) with `injuryKnown` / `qbOut` keyed by game before kickoff.

Until then: **do not request / purchase** a SportsDataIO subscription for E4.

### ScoreTape (documented timestamps — not configured)

[ScoreTape CFB docs](https://scoretape.com/docs) describe `GET /v1/cfb/injuries` with `captured_ms` and as-of reconstruction (`latest row with captured_ms ≤ T`). That **is** the timing shape E4 needs, but no ScoreTape key is present here and this agent must **not** purchase a subscription. Treat as a candidate only after procurement + sample payload review.

### Draft collector (forward evidence)

`scripts/ncaafPregameInjurySnapshotCollector.ts` freezes ESPN’s live CFB injuries feed with an explicit `captureTimestamp` under `test/fixtures/ncaaf-pregame-injury-snapshots/`. Valid as pre-kickoff evidence **only** when `captureTimestamp < game.kickoffIso`. Not a historical backfill.

**Status:** first snapshot recorded in `manifest.json`. Historical holdout backfill is **unavailable** from verified free sources; E4 validation **cannot finish** until the evidence list below accumulates.

## Evidence that must accumulate before E4 validation can finish

Tracked in `test/fixtures/ncaaf-pregame-injury-snapshots/manifest.json` → `evidenceRequiredBeforeE4Validation`:

1. Multiple snapshots spanning a full Odds-listed FBS slate with `captureTimestamp < each game's kickoffIso`.
2. Join producing `injuryKnown=true|null` and optional `qbOut` — **never** coerce missing → `false`.
3. Segment conservatism: mean \|edge\| on `injuryKnown=null` ≤ mean \|edge\| on `injuryKnown=true` with documented n.
4. Competition scope remains Odds-listed FBS only.
5. Do **not** purchase SportsDataIO/ScoreTape solely on unverified archive timing claims.

## Precise remaining E4 requirement

1. Enough snapshots (collector and/or licensed feed with **documented pre-kickoff timestamps**) covering Odds-listed FBS games with `capture < kickoff`.
2. Join producing `injuryKnown=true|null` and optional `qbOut` — **never** coerce missing → `false`.
3. Segment engine \|edge\|: mean \|edge\| on `injuryKnown=null` must **not** exceed mean \|edge\| on `injuryKnown=true`. Document n.
4. Keep `NCAAF_GAME_LINE_SIM_VALIDATED=false` until E4 + E6 (+ E5/E2E) clear.

# Football drive unit rollout and rollback

Engine id: `ppg-per-drive-v1`. This is a review plan. It does not deploy, publish an OTA, or merge.

Correctness does not depend on deploy order. Every game-outcome payload carries `engineVersion`. The client refuses a draw whose stamp is missing or wrong **before** it writes the game-sim cache and **before** `gameSimHitForPick` grades it. A snapshot also carries `simEngineStamp`. Hydrate and `applyServerSlateSnapshot` refuse a snapshot that lacks that stamp, even when the fingerprint already starts with `ppg-per-drive-v1:`.

Football draws must be `ppg-per-drive-v1`. Other sports must be `sport-sim-v1`. HTTP `POST /sports/simulate/game-outcome` and `runGameOutcomeSimInProcess` both return the stamp. In-process slate sims drop a response that fails the same check, so a loopback body cannot grade a draw that lost the field.

## Cache map

| Path | What it stores | What a new client does |
|---|---|---|
| HTTP game-outcome | Nothing. The JSON includes `engineVersion`. | Rejects the body when the stamp does not match, and does not cache it. |
| In-process Coach slate | No draw cache. The returned entry includes `engineVersion`. | `simHitForGameLine` returns null when the stamp does not match. |
| Persistent prop cache | Player-prop hit rates only. | Leave it. It is not a game-score draw. |
| Client game-sim memory | The draw, only after the stamp check. | An unstamped payload is not stored. The next stamped response can still fill the key. |
| Client slate disk and server snapshot | Tickets, grades, and game sims. | Require `simEngineStamp === ppg-per-drive-v1` plus a matching stamp on every stored game sim. |
| `fgDist` WeakMap | Stats for one response object. | A new object is a new key. |

## Server-first rollout

1. Deploy the API. New responses include `engineVersion`. Old clients ignore the field and keep grading whatever the server returns, including the corrected engine. Their disk snapshots stay on the old prefix until that client is updated.
2. Ship the client that enforces the stamp. It will not cache or grade an old server body. Until step 1 is live, that client produces no game-line grades from `/sports/simulate/game-outcome`.
3. Restarting the API process drops in-memory maps. It does not migrate Redis prop entries, and it does not need to: those entries are not game draws.

NCAAF game lines and period markets stay fail-closed on the client. A server deploy does not seat them.

## Rollback

| Rollback | Old client | New client | Cached grades |
|---|---|---|---|
| API back to the pre-stamp server | Keeps working. It never required `engineVersion`. Grades follow the rolled-back engine. | Stops caching and grading game draws until the client rolls back too. Missing stamp is a reject, not a fallback. | New-client disk snapshots fail hydrate because a later read still requires `simEngineStamp`. They are not served. |
| Client back, API stays new | N/A | The old client ignores `engineVersion` and will grade the new engine's draws. It can also keep any snapshot it already stored. | Treat those grades as from the new engine only while the API stays on `ppg-per-drive-v1`. |
| Both back | Previous behavior. | Previous behavior. | Delete or ignore `slate-preanalysis:v5:ppg-per-drive-v1:` keys. The old prefix is `v4` and is not read by the new client. |

Do not copy an old draw into a snapshot and then set `simEngineStamp`. The stamp is written only by a process that received the version on the draw.

## Old clients and the published OTA

The published preview client is commit `bdddb08e` (update `01a13d87-ca55-7c20-b06a-466a3980b888`). It does not read `engineVersion`.

| Store | Published client | What a server deploy does |
|---|---|---|
| In-memory game sim | Key `gamesim:` plus a fingerprint with no engine id. TTL 20 minutes. A hit never calls the server. | Does not delete it. The bad draw is reused until the TTL expires or the process restarts. |
| Disk slate | Prefix `slate-preanalysis:v4:invariants:`. | Does not delete it. The next successful server-slate sync writes a new snapshot into that same key. Until that sync, the old snapshot is what the client shows. |
| HTTP game-outcome | Uncached on the server. | A cache miss receives the corrected engine. |

Server-first deployment fixes the draws an old client fetches after a miss: full-game scores come from `ppg-per-drive-v1`, and the JSON includes `engineVersion`. It does not make the old client reject a draw it already stored.

The published client also rescales period cover rates after the response arrives, in `fetchSlateGameSimulationsWithStatus`, when `outcomes.homeScores` is present and the request includes a non-full-game cover query. Omitting `outcomes` stops that rescale. It does not stop the full-game win-probability fallback: a missing `coverHitRates` entry falls through to `homeWinProbability` / `awayWinProbability` for every moneyline, including a period moneyline.

Every response this process builds for that client goes through `sealPublishedClientPeriodQueries`: tennis, UFC, and team `POST /sports/simulate/game-outcome`, and the in-process slate return. The seal deletes `outcomes` and sets each non-full-game cover rate to 0. `snapshotForClient` and `serializeBoardScan` run `sealCachedGameSim` on the way out, including a snapshot row that was stored before the seal. A period-looking rate key is set to 0, and each stored period line is also written at the published lookup id `game|market|pick`. Full-game rates stay.

The 0 is a temporary compatibility sentinel. The published grader returns a finite rate immediately, and its sanitizer rejects 0, so it does not fall through. New clients must read `coverQueryStatus[id] === "unsupported_market"` and must not treat 0 as a probability. `gameSimHitForPick` returns null when that status is present, even if the numeric rate is inside (0, 1).

A draw the published client already cached on the device is unprotected until the 20-minute `gamesim:` TTL expires or the next `slate-preanalysis:v4` sync replaces it. This server cannot delete that cache.

A new client uses fingerprint prefix `ppg-per-drive-v1` and slate prefix `slate-preanalysis:v5:ppg-per-drive-v1:`. It does not read the published client's keys. It also refuses a body or snapshot whose stamp is missing or wrong before caching or grading.

## Server-first rollout, then the preview client

Do this in order. No production Render deploy, merge, OTA, or native build is part of the preparation below. NCAAF game lines and period markets stay fail-closed through every step.

1. Deploy the API at the candidate SHA. New game-outcome bodies include `engineVersion` and, when a query is not full-game, `coverQueryStatus` plus the 0 sentinel. `snapshotForClient` seals cached snapshot rows on read, so a slate stored before this deploy is sealed when the next client fetches it.
2. Confirm health, a full-game NFL draw, a mixed full-game/period draw, a 400 for missing team ids, and that a premium snapshot with a stored period rate serves that rate as 0 and `unsupported_market`. Old devices still ignore `engineVersion` and `coverQueryStatus`. Fresh responses are sealed. Device caches of earlier draws stay gradeable until the 20-minute memory TTL or the next v4 slate sync.
3. Publish the preview client that rejects a missing or wrong stamp before caching or grading, removes the ESPN period overwrite, and honors `coverQueryStatus`. Until this client is on the device, the 0 sentinel is what stops the published grader. The new fingerprint prefix is `ppg-per-drive-v1|`. The new disk prefix is `slate-preanalysis:v5:ppg-per-drive-v1:`.
4. Cache refresh after that client is running: the new prefix does not read `slate-preanalysis:v4:invariants:`. The next successful slate sync writes the v5 snapshot. In-memory `gamesim:` entries expire after 20 minutes or when the process restarts. Do not copy an old draw into a v5 snapshot and then set `simEngineStamp`.

Rollback:

| Step | What happens |
|---|---|
| API back, preview client not yet shipped | Old clients keep grading the rolled-back engine. The 0 sentinel and `coverQueryStatus` disappear with the API. Cached device draws are unchanged. |
| API back after the preview client shipped | The new client stops caching and grading game draws until it rolls back too. A missing stamp is a reject. |
| Preview client back, API stays | The old client ignores `engineVersion` and `coverQueryStatus`. It grades fresh sealed responses via the 0 sentinel and can keep any v4 snapshot it already stored. |
| Both back | Ignore keys `slate-preanalysis:v5:ppg-per-drive-v1:`. Do not copy an old draw into a snapshot and then set `simEngineStamp`. |

## Staging test and rollback checklist

Run these on the candidate SHA before any staging deploy. They do not deploy, publish, or merge.

1. Engine stamp survives the HTTP-shaped body, the in-process copy, and snapshot redaction.
   ```bash
   cd artifacts/api-server
   node --import ./test/register-hooks.mjs --test \
     test/footballDriveUnit.test.ts \
     test/coachSlateTypes.test.ts \
     test/gameOutcomePayload.test.ts
   ```
2. Cache rejection. An unstamped draw is not stored and is not graded. A fingerprint prefix without `simEngineStamp` does not hydrate.
   ```bash
   cd artifacts/stadium-mobile
   node --test lib/gameSimEngineVersion.test.ts lib/coachContextCache.test.ts lib/slatePreAnalysisCache.test.ts
   ```
3. Realistic score distributions. Low, average, and high points-per-game fixtures stay near their inputs. The legacy hard-cap means near 42 are the comparison printed in the test log, not the corrected projection.
   ```bash
   cd artifacts/api-server
   node --import ./test/register-hooks.mjs --test test/footballDriveUnit.test.ts
   ```
4. Exact NFL request. Parser and terminal tests, then the device check on staging after the API is deployed there.
   ```bash
   cd artifacts/stadium-mobile
   node --test lib/coachAskMarketFilter.test.ts lib/coach/session.test.ts
   ```
   Ask text: `4 leg NFL spreads and moneylines for upcoming games.`
   Expected locally: `fullGameOnly` true, props excluded, Q3 and other period markets excluded, full-game spread and moneyline kept. Loading clears on success, failure, cancellation, and deadline expiry.
   On an isolated staging API of this SHA, before any production deploy or OTA: send that exact ask. Loading must clear. The result is a full-game spread/moneyline ticket or an honest shortfall. It must not remain on “Scoring ticket… 3 legs (3 props/alts)”. Load, scan, the UI latch, and `coachTerminalLiveDeadlineMs` share one deadline: 75 seconds for 4 legs. Cancellation and that deadline abort in-flight work. A result that arrives after the latch is dropped. NCAAF game lines and period markets stay absent.

Rollback, if staging misbehaves:

| Step | Action |
|---|---|
| API back | Old clients keep working and grade the rolled-back engine. New clients stop caching and grading until they roll back too, because a missing stamp is a reject. |
| Client back, API stays | The old client ignores `engineVersion` and grades the new engine. Its `v4` snapshot can remain until overwritten. |
| Both back | Ignore keys `slate-preanalysis:v5:ppg-per-drive-v1:`. Do not copy an old draw into a snapshot and then set `simEngineStamp`. |

NCAAF game lines and period markets stay fail-closed through every step. No production OTA and no native build are part of this checklist.

## Measured holdouts (2026-10-15, 10,000 sims, primary seed 20241015)

These numbers are recorded runs. They do not change thresholds and they do not authorize a deploy. NFL distribution figures are not evidence of market value. `ODDS_API_KEY` is unset, so qualified NFL selections versus closing prices stay `NOT_MEASURED`.

NCAAF 2024 holdout, report `2026-10-15T10:37:48.628Z`, 865 games, 10,000 sims, seed 20241015. Credible last-play stamps where they exist; otherwise kickoff plus 4 hours. Brier 0.19860, ECE 0.05296, bias +0.03698, official dog cover 0.6757 (n=111). Those scored metrics match the prior 4-hour-only run. Excluding every prior that lacks a credible stamp is a sensitivity check: 861 scored, Brier 0.20091, ECE 0.04498, bias +0.03701. The coin-baseline outcome gate (`E2_outcomeVsCoin`) is PASS on seed 20241015. The 2026-10-14 E2a claim stays withdrawn (`priorE2aClaim.restored` false). Closing lines are loaded (770 joins). Soft gates on this engine are PASS_SOFT_GATES_ONLY (engine Brier 0.2165, market Brier 0.1768, mean gap +0.0366). CLV stays OPEN_NEEDS_AGREED_TOLERANCE. Restore is OPEN_NEEDS_VALIDATION_INJURY_SIGNOFF. `NCAAF_GAME_LINE_SIM_VALIDATED` stays false.

NFL 2024 regular-season holdout, report `2026-10-15T10:37:18.820Z`, 272 games, same completion rule, 10,000 sims, seed 20241015. Fixture `nfl-historical-games.json` (815 ESPN finals, 2022–2024, no closing odds). 801 games have a credible last-play stamp and 14 use the 4-hour assumption. Brier 0.23522, ECE 0.04331, bias −0.00361. Score mean error home −0.84, away −1.06. Team-score z SD 1.060, margin z SD 1.138, \|z\| > 2 rate 0.059. Fair-line home cover 0.474 (sim mean margin, not a sportsbook close). Away blowout actual 0.143 vs predicted 0.108. The diagnostic +7.5 dog cohort is 0.711 on the primary seed (n=76) and 0.711–0.726 across seeds. That 0.70 cap is the NCAAF E2a gate. It was not applied as an NFL pass/fail and it was not retuned. Dropping priors that lack a credible stamp still scores 272 games: Brier 0.23728, ECE 0.04166, bias −0.00543. This rerun is the form-availability correction. It is not a market-value result.

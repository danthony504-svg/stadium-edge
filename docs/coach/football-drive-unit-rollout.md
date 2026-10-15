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

The published client also rescales period cover rates after the response arrives, in `fetchSlateGameSimulationsWithStatus`, when `outcomes.homeScores` is present and the request includes a non-full-game cover query. That code is on the device. A corrected server body does not remove it. `POST /sports/simulate/game-outcome` now omits `outcomes` when any cover query has a period other than `fg`, so that published path has no score arrays to rescale. Full-game requests still include `outcomes`. Cover rates for the full game stay on `coverHitRates`. Period markets stay fail-closed on the new client. The published client can still treat a period moneyline as the full-game win probability when no period cover rate is present. Stopping that fallback requires the client update.

A new client uses fingerprint prefix `ppg-per-drive-v1` and slate prefix `slate-preanalysis:v5:ppg-per-drive-v1:`. It does not read the published client's keys. It also refuses a body or snapshot whose stamp is missing or wrong before caching or grading.

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
   On staging, after the API deploy and before any OTA: send that exact ask. Loading must clear. The result is a full-game spread/moneyline ticket or an honest shortfall. It must not remain on “Scoring ticket… 3 legs (3 props/alts)”. The 4-leg absolute budget is 75 seconds; the live hang ceiling in `coachTerminalLiveDeadlineMs(4)` is that budget plus grace plus 45 seconds. NCAAF game lines and period markets stay absent.

Rollback, if staging misbehaves:

| Step | Action |
|---|---|
| API back | Old clients keep working and grade the rolled-back engine. New clients stop caching and grading until they roll back too, because a missing stamp is a reject. |
| Client back, API stays | The old client ignores `engineVersion` and grades the new engine. Its `v4` snapshot can remain until overwritten. |
| Both back | Ignore keys `slate-preanalysis:v5:ppg-per-drive-v1:`. Do not copy an old draw into a snapshot and then set `simEngineStamp`. |

NCAAF game lines and period markets stay fail-closed through every step. No production OTA and no native build are part of this checklist.

## Measured holdouts (2026-10-15, 10,000 sims, primary seed 20241015)

These numbers are recorded runs. They do not change thresholds and they do not authorize a deploy. NFL distribution figures are not evidence of market value. `ODDS_API_KEY` is unset, so qualified NFL selections versus closing prices stay `NOT_MEASURED`.

NCAAF 2024 holdout, report `2026-10-15T10:14:01.742Z`, 865 games, 10,000 sims, seed 20241015. Credible last-play stamps where they exist; otherwise kickoff plus 4 hours. Brier 0.19860, ECE 0.05296, bias +0.03698, official dog cover 0.6757 (n=111). Those scored metrics match the prior 4-hour-only run. E2a PASS on seed 20241015. The 2026-10-14 PASS stays withdrawn. Closing lines are loaded (770 joins). Soft gates on this engine are PASS_SOFT_GATES_ONLY (engine Brier 0.2165, market Brier 0.1768, mean gap +0.0366). CLV stays OPEN_NEEDS_AGREED_TOLERANCE. Restore is OPEN_NEEDS_VALIDATION_INJURY_SIGNOFF. `NCAAF_GAME_LINE_SIM_VALIDATED` stays false.

NFL 2024 regular-season holdout, report `2026-10-15T10:13:35.456Z`, 272 games, same completion rule, 10,000 sims, seed 20241015. Fixture `nfl-historical-games.json` (815 ESPN finals, 2022–2024, no closing odds). 801 games have a credible last-play stamp and 14 use the 4-hour assumption. Brier 0.23522, ECE 0.04331, bias −0.00361. Score mean error home −0.84, away −1.06. Team-score z SD 1.060, margin z SD 1.138, \|z\| > 2 rate 0.059. Fair-line home cover 0.474 (sim mean margin, not a sportsbook close). Away blowout actual 0.143 vs predicted 0.108. The diagnostic +7.5 dog cohort is 0.711 on the primary seed (n=76) and 0.711–0.726 across seeds. That 0.70 cap is the NCAAF E2a gate. It was not applied as an NFL pass/fail and it was not retuned. This rerun is the form-availability correction. It is not a market-value result.

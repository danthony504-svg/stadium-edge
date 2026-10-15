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

## Old clients

An old client cannot see the stamp check. It will cache and grade the response it gets. Shipping the API first is safe for those clients and is still the preferred order so they start receiving corrected scores. It is not the mechanism that protects a new client.

## Measured holdouts (2026-10-15, 10,000 sims, primary seed 20241015)

These numbers are the recorded runs. They do not change thresholds and they do not authorize a deploy.

NCAAF 2024 holdout, 865 games, priors limited to games completed before kickoff (kickoff + 4 hours): Brier 0.19860, ECE 0.05296, bias +0.03698, official dog cover 0.6757 (n=111). E2a PASS on seed 20241015. The 2026-10-14 PASS stays withdrawn. The PR 737 archive joins 770 games. Soft gates on this engine are PASS_SOFT_GATES_ONLY (engine Brier 0.2165, market Brier 0.1768, mean gap +0.0366). CLV stays OPEN_NEEDS_AGREED_TOLERANCE. `NCAAF_GAME_LINE_SIM_VALIDATED` stays false.

NFL 2024 regular-season holdout, 272 games, fixture `nfl-historical-games.json` (815 ESPN finals, 2022–2024, no closing odds): Brier 0.23553, ECE 0.03645, bias −0.00351. Score mean error home −0.84, away −1.07. Team-score z SD 1.059, margin z SD 1.137, \|z\| > 2 rate 0.057. Fair-line home cover 0.478 (sim mean margin, not a sportsbook close). Home blowout (≥14) actual 0.188 vs predicted 0.185. Away blowout actual 0.143 vs predicted 0.108. High total (sim mean + 14) actual 0.162 vs predicted 0.150. The diagnostic +7.5 dog cohort is 0.707 on the primary seed (n=75) and 0.707–0.736 across seeds. That 0.70 cap is the NCAAF E2a gate. It was not applied as an NFL pass/fail and it was not retuned.

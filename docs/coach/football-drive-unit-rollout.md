# Football drive unit rollout

Engine id: `ppg-per-drive-v1`. This document is the ship order. It does not deploy, publish an OTA, or merge.

## Cache map

| Path | What it stores | Invalidation |
|---|---|---|
| HTTP `POST /sports/simulate/game-outcome` | Nothing. Each request runs `runSportGameMonteCarlo`. | A new server process returns the new engine on the next call. `simModelLabel` includes `ppg-per-drive-v1`. |
| In-process Coach slate | The same `runSportGameMonteCarlo` call, no separate draw cache. | Same process as the HTTP route. Slate snapshots are keyed by `computeSlateFingerprint`, which starts with `ppg-per-drive-v1`. |
| Persistent prop cache (`simCacheKey` → Redis or memory) | Player-prop hit rates only. It does not store game-outcome draws. | Unchanged by this engine. Do not treat a prop-cache hit as a game-score draw. |
| Client game-sim memory (`fingerprintCoachGameSim`) | Full-game draw for the session. | Key starts with `ppg-per-drive-v1\|`. Old keys miss. |
| Client slate disk (`AsyncStorage`) | Precomputed tickets and grades. | Storage prefix is `slate-preanalysis:v5:ppg-per-drive-v1:`. Hydrate and `applyServerSlateSnapshot` refuse a fingerprint that does not start with `ppg-per-drive-v1:`. |
| Distribution memo (`fgDist` WeakMap) | Series stats for one response object. | A new response object is a new key. |

## Ship order

1. Deploy the API that contains `ppg-per-drive-v1` before any client build that writes the new fingerprints. The HTTP route is uncached, so the first request after the deploy is the new engine.
2. Ship the client in the same window. If the client ships first, it will refuse old slate snapshots and then cache whatever the still-old server returns under the new fingerprint. That would pin the hard-cap scores until the odds fingerprint changes.
3. After both are live, a process restart clears the in-memory game-sim map. Disk snapshots from `v4` are not read.

NCAAF game lines and period markets stay fail-closed on the client regardless of this engine. A server deploy does not seat them.

## Measured holdouts (2026-10-15, 10,000 sims, primary seed 20241015)

These numbers are the recorded runs. They do not change thresholds and they do not authorize a deploy.

NCAAF 2024 holdout, 865 games: Brier 0.19857, ECE 0.05054, bias +0.03708, official dog cover 0.6727 (n=110). E2a PASS on this seed. The 2026-10-14 PASS stays withdrawn. E2b is INSUFFICIENT_DATA because `ncaaf-phase-e-closing-lines.json` is absent and zero rows joined. `NCAAF_GAME_LINE_SIM_VALIDATED` stays false.

NFL 2024 regular-season holdout, 272 games, fixture `nfl-historical-games.json` (815 ESPN finals, 2022–2024, no closing odds): Brier 0.23553, ECE 0.03645, bias −0.00351. Score mean error home −0.84, away −1.07. Team-score z SD 1.059, margin z SD 1.137, \|z\| > 2 rate 0.057. Fair-line home cover 0.478 (sim mean margin, not a sportsbook close). Home blowout (≥14) actual 0.188 vs predicted 0.185. Away blowout actual 0.143 vs predicted 0.108. High total (sim mean + 14) actual 0.162 vs predicted 0.150. The diagnostic +7.5 dog cohort is 0.707 on the primary seed (n=75) and 0.707–0.736 across seeds. That 0.70 cap is the NCAAF E2a gate. It was not applied as an NFL pass/fail and it was not retuned.

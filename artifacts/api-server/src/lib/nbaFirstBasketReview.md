# NBA First Basket review

The Simulator reads `/sports/nba-first-basket-model`. It displays “Waiting for confirmed starters” until both fives are verified. A lineup update revoking confirmation suppresses prior prices. The client checks every minute in the final hour and every five minutes earlier.

## Capture and book rules

Set `NBA_FIRST_BASKET_CAPTURE` to a trusted JSON file with `snapshots` and `history` arrays. Use the types in `nbaFirstBasketModel.ts`. Bind event, team and player IDs to the Simulator through a verified provider crosswalk. Supply confirmed starters, weighted `likelyJumpers` from those starters, full-game per-minute shooting opportunity priors, and chronological opening possessions with clocks. A legacy `jumperId` supplies a single projected candidate. Capture the historical jumpers, tip winner and first possession independently using finalized play-by-play.

The capture script accepts trusted lineup snapshots and finalized opening feeds. Use complete chronological possessions and explicit possession IDs and teams from the licensed feed adapter. When the provider supplies only a “Tip to” description, require independent evidence of the tip winner. Preserve distinct first-points and first-field-goal outcomes, including scorer, method and game clock. Player-share fitting uses complete possessions inside the first two minutes, with full-game usage as a prior. The model computes team-first probability times player share directly on 4,096 parameter draws. The game replay remains a separate possession simulation.

Publish files atomically. A scratch must produce a newer snapshot with `confirmedAt: null` until the replacement is confirmed. Record each book/market’s FT rule, `voidRule.notStarter`, and `voidRule.didNotPlay` from verified settlement terms. Grades assume a confirmed starter and void if the player does not play. The parser withholds unknown or unsupported terms. It removes vig from verified Yes/No pairs or verified exhaustive starter fields after checking actual identities. Incomplete fields display the posted price only.

## Staging and validation

`scripts/replayNbaFirstBasket.ts` accepts a recorded timeline of polls, lineup captures, odds responses, and optional finalized opening play-by-play. It drives the same review logic on a virtual clock, with no provider requests. Use a scratch timeline to check that the stale starter is erased, the pending lineup has no prices, and the new confirmed five causes a cache miss.

`scripts/backtestNbaFirstBasket.ts` first reports tip, first-points team and first-field-goal team calibration. After reviewing those results, rerun with `--closing` to add paired whole-market log loss against a verified complete no-vig closing field. A missing or partial field still contributes to eligible team-level calibration. It contributes no whole-market comparison.

## On-demand odds fallback

Without an archive configured, the backend uses an existing `ODDS_API_KEY` to fetch only supported configured markets through the exact event-odds endpoint in the final 45 minutes. It shares a three-minute cache per event and confirmed starting five. A change to the five can cause one additional request on the next poll, while reordering the same players reuses the key. With three returned markets and one region, the stable schedule is up to 15 calls or 45 credits per game per cache stream, plus up to three credits per additional request. The previous one-minute upstream cadence could use 135 credits in the same window. Concurrent cold misses across independent instances can add requests. Use the provider’s quota headers on staging traffic before enabling live service.

## Pre-release collector and grade cap

On an isolated backend, mount a writable durable `NBA_FIRST_BASKET_ARCHIVE_DIR` shared by the API and a single collector. Configure the normalized lineup capture path and existing Odds API credentials. Run `scripts/collectNbaFirstBasket.ts --watch` to record the provider's event, book, market, quote, and timestamp fields for every observed request, confirmed lineups, scratch revisions, and provider quota headers. The app reads archived prices in this mode, avoiding a parallel upstream polling stream. With only a lineup feed, the collector can archive lineups without an Odds API key. There are no provider requests outside the final 45 minutes.

Leave `NBA_FIRST_BASKET_FAST_RESERVE` unset for three-minute odds polling. A positive reserve allows one-minute polling in the final ten minutes only while a current provider quota reading leaves the reserve after the next request. Market counts and cold starts can vary. With all three markets returned in one region, continuous one-minute polls in the last ten minutes can reach 66 total credits per game on a stable lineup versus 45 at the default cadence. Scratches can add requests to both schedules. `scripts/collectNbaFirstBasket.ts --week YYYY-MM-DD` reports seven Central-time slate days, separating unobserved days and calls without quota headers from measured credits.

Run `scripts/tuneNbaFirstBasket.ts <data.json>` to compare strengths using chronological folds and conditional first-team-field-goal scorer log loss. The final time block is excluded from selection and reports the selected strength against the baseline. Only source observations available before the forecast enter the model. The fitted 2025–26 research prior is 70. Keep the Lean cap while calibration and closing-field validation are open.

Run stage one on at least a season of verified play-by-play and as-of lineups. Review the observed size and absolute error in each calibration bin against the two-percentage-point target. Then collect a few hundred games with complete closing fields and run the paired closing comparison. The backtest can use `--archive` with normalized `history` and `finals`, and `--closing` enables paired market scoring. Grades are capped at Lean in code pending real calibration and closing validation.

## Staging deployment

`render.first-basket-staging.yaml` describes one paid Render background worker with one 1 GB persistent disk. The disk's automatic snapshots run every 24 hours with seven days of retention. The worker bundles without the main API, database, or client dependencies. Render plan auto-sync and deploy-on-push are disabled.

Set the existing Odds API key, the authenticated normalized lineup capture URL and token, the missing-night alert webhook, and the external dead-man heartbeat URL in Render. The worker polls the lineup source before collection and only refreshes the feed file after a successful authenticated response. Its daily audit checks an independent NBA schedule so a missing capture cannot be mistaken for an off night. Configure the external monitor to alert when several consecutive one-minute heartbeats are missed, including during a worker-wide outage. The webhook expects a JSON object with a `text` field.

The pre-release credit defaults are 45 credits per game inclusive of scratches, 675 per slate, and a 100-credit remaining reserve, configurable on the staging worker. Fast refresh remains disabled. Run the bundled worker with `--week YYYY-MM-DD` for the seven-day go/no-go audit against the schedule, provider credit headers, and confirmed lineup revisions. A missing pre-tip quote, a pending scratch, an unrepriced revision, an unknown credit balance, or a budget violation fails that game's audit. The archive records confirmation revision as part of the quote key so a re-confirmation of the same five also fetches again.

### Seven-night go/no-go

Start the seven consecutive Central-time slate days after real credentials, the archive, and both monitoring endpoints are verified. The smoke Blueprint writes a separate disk receipt and exercises monitoring callbacks locally with zero paid calls. Its traffic never counts toward the week.

- Require each scheduled game to have a bound pre-tip quote and verified lineup. Check the schedule independently and explicitly account for off nights.
- For every observed scratch, require the pending lineup to withhold pricing and the newly confirmed lineup to reprice. If the week has no scratches, retain the recorded scratch replay as the evidence and mark live scratch handling unobserved.
- Require measured provider credits, at most 45 per game and 675 per slate including scratches, with the 100-credit reserve preserved. Verify that quota failures and low disk stop spending.
- Require recent daily disk snapshots, more than or equal to 64 MiB free, and verified delivery of both the missing-night alert and an external missed-heartbeat alert. Any missing scheduled game, unexplained credit, or failed alert is a no-go.
- Report confirmed, unconfirmed, and unknown pricing attempts when the endpoint is serving requests. Keep Lean until holdout tip-win and team-first bins meet the under-two-point target and the comparison with complete no-vig closing fields passes.

Render persistent disk documentation: https://render.com/docs/disks#disk-snapshots

## 2025–26 original processed-table replay

Normalized 1,200 of 1,230 reported games. The importer excluded 27 with unbound starters or jumpers and three missing opening tip, start, final, or possession evidence. After requiring usable prior team history, 1,184 games received forecasts. Recorded starting fives are provided to the replay. The pregame jumper weights and usage use earlier completed games. The original import assigns jump participants from a processed jump row and first possession from the derived possession table. The raw-field audit below supersedes this sample for tip and team calibration. This is retrospective lineup-conditioned analysis with no prospective lineup publication timestamps or licensed production corroboration.

| Usage strength | Development log loss | Final block log loss |
| ---: | ---: | ---: |
| 5 | 1.7041 | 1.6677 |
| 15 | 1.6523 | 1.6208 |
| 35 | 1.6221 | 1.5965 |
| 70 | 1.6079 | 1.5883 |

Selection used 943 games across the first four chronological blocks. The final block contains 241 games and 480 team scorer outcomes. The selected strength of 70 is the strongest candidate in the tested grid. Tip-win calibration missed the under-two-percentage-point target in both 500+ game bins, at 2.36 and 5.54 points. Team-first-points errors in its two 500+ game bins were 2.63 and 2.32 points. First-team-field-goal errors in its two 500+ game bins were 2.50 and 0.53 points. No closing-field comparison was run.

Public research tables: https://github.com/ramirobentes/nba_data

## 2025–26 original processed-table uncertainty checks

Wilson 95% intervals are for observed frequencies. Signed error intervals subtract the mean forecast in that bin. These are per-bin intervals and do not adjust for repeated teams, multiple bins, or uncertainty in the archived labels. Empty bins report zero games with null intervals in the backtest.

### Season replay

| Market | Forecast bin | Games | Mean forecast | Observed | Observed 95% | Observed minus forecast 95% (pp) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Tip win | 20–30% | 4 | 27.26% | 0.00% | 0.00–48.99% | -27.26 to 21.72 |
| Tip win | 30–40% | 63 | 37.33% | 28.57% | 18.90–40.70% | -18.43 to 3.37 |
| Tip win | 40–50% | 501 | 46.27% | 43.91% | 39.63–48.29% | -6.64 to 2.02 |
| Tip win | 50–60% | 549 | 53.66% | 59.20% | 55.04–63.23% | 1.38 to 9.57 |
| Tip win | 60–70% | 65 | 63.00% | 87.69% | 77.55–93.63% | 14.55 to 30.63 |
| Tip win | 70–80% | 2 | 71.56% | 100.00% | 34.24–100.00% | -37.32 to 28.44 |
| First points | 30–40% | 45 | 38.01% | 46.67% | 32.94–60.92% | -5.08 to 22.91 |
| First points | 40–50% | 537 | 46.35% | 48.98% | 44.77–53.20% | -1.57 to 6.85 |
| First points | 50–60% | 567 | 53.77% | 56.08% | 51.97–60.12% | -1.80 to 6.35 |
| First points | 60–70% | 35 | 62.31% | 57.14% | 40.86–72.02% | -21.45 to 9.70 |
| First field goal | 30–40% | 40 | 37.96% | 47.50% | 32.94–62.50% | -5.02 to 24.54 |
| First field goal | 40–50% | 544 | 46.21% | 48.71% | 44.54–52.91% | -1.67 to 6.70 |
| First field goal | 50–60% | 560 | 53.76% | 54.29% | 50.14–58.37% | -3.61 to 4.61 |
| First field goal | 60–70% | 40 | 62.24% | 55.00% | 39.83–69.29% | -22.41 to 7.05 |

### Final time block

| Market | Forecast bin | Games | Mean forecast | Observed | Observed 95% | Observed minus forecast 95% (pp) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Tip win | 20–30% | 3 | 26.41% | 0.00% | 0.00–56.15% | -26.41 to 29.74 |
| Tip win | 30–40% | 18 | 37.31% | 38.89% | 20.31–61.38% | -17.00 to 24.08 |
| Tip win | 40–50% | 104 | 46.04% | 48.08% | 38.72–57.58% | -7.33 to 11.53 |
| Tip win | 50–60% | 100 | 53.75% | 62.00% | 52.21–70.90% | -1.54 to 17.15 |
| Tip win | 60–70% | 14 | 64.29% | 100.00% | 78.47–100.00% | 14.18 to 35.71 |
| Tip win | 70–80% | 2 | 71.56% | 100.00% | 34.24–100.00% | -37.32 to 28.44 |
| First points | 30–40% | 17 | 37.24% | 29.41% | 13.28–53.13% | -23.96 to 15.89 |
| First points | 40–50% | 102 | 46.41% | 47.06% | 37.66–56.68% | -8.75 to 10.27 |
| First points | 50–60% | 114 | 53.98% | 56.14% | 46.98–64.90% | -7.00 to 10.92 |
| First points | 60–70% | 8 | 63.22% | 62.50% | 30.57–86.32% | -32.64 to 23.10 |
| First field goal | 30–40% | 13 | 36.72% | 23.08% | 8.18–50.26% | -28.54 to 13.53 |
| First field goal | 40–50% | 108 | 46.14% | 50.00% | 40.73–59.27% | -5.40 to 13.13 |
| First field goal | 50–60% | 109 | 54.11% | 54.13% | 44.79–63.18% | -9.32 to 9.07 |
| First field goal | 60–70% | 11 | 62.06% | 63.64% | 35.38–84.83% | -26.68 to 22.78 |

The paired bootstrap resampled 241 holdout games with their 480 scorer outcomes together, over 20,000 replicates. The 35-to-70 prior change improved log loss by 0.00823, with a 95% interval of 0.00083 to 0.01566. The relative gain was 0.515% with a 95% interval of 0.053% to 0.968%. This measures uncertainty on the retained sample and uses the same model and scoring rules.

The processed archive labels the tip winner as the first-possession team in 1,200 of 1,200 games, with a Wilson 95% interval of 99.68% to 100%. Both labels come from the same play-by-play archive and the import reconstructs the initial jump from the recovered jump-ball record. The perfect agreement needs independently labeled jump and possession data before treating it as a league retention estimate. The tip and team-first equations run before player allocation, so changing the player usage prior cannot fix those team-level errors.

## 2025–26 raw opening-label audit

The importer now binds the raw feed's explicit winner and loser IDs to the two starting fives and reads possession from the first usable play after the opening jump. It checks that the derived shot segments agree with that play. A missing or conflicting observation is excluded. The importer never substitutes the jump winner or the jump row's team for the post-jump possession.

A chronological sample of 30 games included 27 shot attempts, two turnovers, and one foul as first observed actions. The acting team independently matched the possession field on all 29 shots and turnovers. The foul was by the defense. Five jump rows in the original 1,200-game sample had a blank or zero possession field and were identifiable from later action. All 1,200 original labels agreed with the raw-field check. Explicit jumper IDs also restored 24 games that the original processed-table import excluded. Of 1,230 source games, 1,224 qualified and six lacked required opening or final evidence. The raw archive still gives 1,224 of 1,224 tip winners the first observed possession (descriptive Wilson 95% interval 99.69–100%). This rules out a forced equality in this importer. Both observations still come from the same feed, which can credit jump winners based on recovery and omit changes before its first recorded play. It does not independently validate a league retention probability.

No tip model tuning was applied. The season 50–60% tip bin still misses the target. The corresponding final-block interval contains zero and does not establish calibration. The Lean cap stays in place.

Raw archive: https://github.com/jsierrahoopshype/nba-data-archive/releases/tag/cdnnba

### Season replay (1208 forecasts)

| Outcome | Forecast bin | Games | Mean forecast | Observed | Observed 95% | Observed minus forecast 95% (pp) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Tip win | 20–30% | 3 | 26.47% | 0.00% | 0.00%–56.15% | -26.47 to 29.68 |
| Tip win | 30–40% | 64 | 37.24% | 31.25% | 21.23%–43.39% | -16.01 to 6.15 |
| Tip win | 40–50% | 522 | 46.33% | 44.83% | 40.61%–49.12% | -5.72 to 2.79 |
| Tip win | 50–60% | 556 | 53.70% | 58.99% | 54.86%–63.01% | 1.16 to 9.31 |
| Tip win | 60–70% | 61 | 63.11% | 88.52% | 78.16%–94.33% | 15.04 to 31.21 |
| Tip win | 70–80% | 2 | 71.56% | 100.00% | 34.24%–100.00% | -37.32 to 28.44 |
| First points | 30–40% | 39 | 37.67% | 46.15% | 31.57%–61.43% | -6.10 to 23.76 |
| First points | 40–50% | 552 | 46.33% | 49.46% | 45.30%–53.62% | -1.02 to 7.29 |
| First points | 50–60% | 582 | 53.65% | 56.19% | 52.13%–60.16% | -1.52 to 6.52 |
| First points | 60–70% | 35 | 62.39% | 51.43% | 35.57%–67.01% | -26.82 to 4.62 |
| First field goal | 30–40% | 42 | 37.71% | 50.00% | 35.53%–64.47% | -2.18 to 26.77 |
| First field goal | 40–50% | 562 | 46.35% | 48.58% | 44.47%–52.70% | -1.88 to 6.36 |
| First field goal | 50–60% | 568 | 53.77% | 54.58% | 50.47%–58.63% | -3.30 to 4.86 |
| First field goal | 60–70% | 36 | 62.61% | 50.00% | 34.47%–65.53% | -28.14 to 2.91 |

### Final chronological block (246 forecasts)

| Outcome | Forecast bin | Games | Mean forecast | Observed | Observed 95% | Observed minus forecast 95% (pp) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Tip win | 20–30% | 3 | 26.47% | 0.00% | 0.00%–56.15% | -26.47 to 29.68 |
| Tip win | 30–40% | 17 | 37.30% | 41.18% | 21.61%–63.99% | -15.69 to 26.69 |
| Tip win | 40–50% | 107 | 46.04% | 49.53% | 40.24%–58.86% | -5.80 to 12.82 |
| Tip win | 50–60% | 102 | 53.79% | 60.78% | 51.08%–69.70% | -2.71 to 15.91 |
| Tip win | 60–70% | 15 | 64.24% | 100.00% | 79.61%–100.00% | 15.38 to 35.76 |
| Tip win | 70–80% | 2 | 71.56% | 100.00% | 34.24%–100.00% | -37.32 to 28.44 |
| First points | 30–40% | 14 | 36.87% | 28.57% | 11.72%–54.65% | -25.15 to 17.78 |
| First points | 40–50% | 108 | 46.26% | 48.15% | 38.95%–57.47% | -7.31 to 11.21 |
| First points | 50–60% | 115 | 54.00% | 55.65% | 46.54%–64.40% | -7.47 to 10.40 |
| First points | 60–70% | 9 | 62.85% | 66.67% | 35.42%–87.94% | -27.43 to 25.09 |
| First field goal | 30–40% | 16 | 36.99% | 31.25% | 14.16%–55.60% | -22.82 to 18.61 |
| First field goal | 40–50% | 104 | 46.21% | 50.96% | 41.49%–60.36% | -4.72 to 14.15 |
| First field goal | 50–60% | 115 | 54.03% | 53.91% | 44.82%–62.75% | -9.20 to 8.72 |
| First field goal | 60–70% | 11 | 62.26% | 54.55% | 28.01%–78.73% | -34.25 to 16.47 |

## 2026–27 fixed usage-prior retest

For 265 games from October 20 through November 25 Central time, the fixed 70 prior improved conditional first team field-goal scorer log loss from 1.64512 to 1.61603 over 525 eligible scorer outcomes. The paired gain was 0.02910 (95% interval 0.01891 to 0.03942, 20,000 game-level resamples). The replay froze audited 2025–26 opening history, built usage rates only from earlier completed games, and used recorded starters and scorers from the next season's processed archive. Raw 2026–27 opening fields were unavailable, so none of that season's derived tip or first-possession labels entered the model or a calibration report. This is an out-of-season scorer comparison conditioned on known starters. It includes no as-of lineup test or closing-price benchmark. Keep the usage prior at 70 and the grade capped at Lean.

Processed season data: https://github.com/ramirobentes/nba_data/releases

## Operational safeguards

The single collector reserves the maximum possible charge on disk before each paid request. It stops at 45 credits per game or 675 per Central-time slate by default, and verifies at least 100 credits remain after the next request using the quota-free sports endpoint. A missing balance stops paid requests. A lost response leaves the conservative debit in place. The reserve check uses the latest provider balance and cannot lock out other clients using the same API key.

Below 64 MiB free, the worker sends a low-disk alert, skips the collector, and withholds the success heartbeat. A failed collection or unreadable quota also withholds the heartbeat. The worker suppresses repeat disk alerts until space recovers. The dead-man receiver and alert delivery require a live endpoint test after deployment.

Quote archives retain only event, bookmaker, market, outcome and timestamp fields. They exclude configured secrets, request URLs, and provider exceptions. Route telemetry records the event ID and confirmed, unconfirmed, unknown, or excluded status without recording quote values or user identifiers. The archive separately reports the confirmation rate among observed collector pricing attempts. Unknown statuses stay outside the rate denominator. The live API deploy checked on November 26 still contains the legacy history route and has no First Basket pricing endpoint, so there is no production pricing-time rate yet.

The Odds API quota documentation: https://the-odds-api.com/liveapi/guides/v4/index.html#response-headers

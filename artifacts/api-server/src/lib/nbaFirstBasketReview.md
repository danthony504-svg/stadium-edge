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

## Tip-win logistic recalibration

The unconstrained replay at commit `c45b75b` uses separate normalized fit and holdout files. Fit the home-tip outcome against the log-odds of each as-of forecast on the audited 2025–26 cohort. Freeze the intercept and slope before scoring any 2026–27 games. Retain the existing usage prior of 70 and the raw jump and possession labels.

The 2026–27 replay uses recorded starters, verified earlier opening history frozen to 2025–26, and processed 2026–27 tip and first-points outcomes. Raw 2026–27 jump records and prospective lineup publication timestamps were unavailable. The scratch, quota, and closing-field checks still require live collection.

The season 50–60% tip bin was underconfident: 53.70% forecast versus 58.99% observed. The mirror 40–50% bin was 46.33% versus 44.83%. The extreme bins have much smaller samples. The observed error intervals are per bin and the slope interval is an unclustered fit interval. Paired log-loss gain intervals resample games.

For the team-scores-first replay, keep the original scoring and retention draws and shift the tip draws to reach the recalibrated mean. This holds the other inputs fixed. The recalibration is evaluated offline. Live pricing still uses the existing tip model and the Lean cap.

The fit used 1,208 games. The intercept was +0.1138 and the slope was 2.4965 (95% interval 1.973–3.020). The fit spreads the probabilities farther from 50%. In the 265-game holdout, tip log loss changed from 0.66012 to 0.65993 and Brier score from 0.23401 to 0.23375. The paired log-loss gain was 0.00020 (95% interval −0.02802 to +0.02692). The high-end training miss did not repeat at the same size in the holdout. The adjusted 80–90% bin also overshot by 27.14 points in nine games. The candidate fails the release criterion and remains offline.

Team-scores-first log loss changed from 0.68826 to 0.68555, a gain of 0.00271 (95% interval −0.00573 to +0.01113). The adjusted central-bin signed intervals both included zero. This holdout does not establish calibration or a measurable scoring improvement.

### 2026–27 tip holdout

| Forecast | Bin | Games | Mean | Observed | Error (pp) | 95% interval (pp) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 20–30% | 5 | 27.82% | 0.00% | -27.82 | -27.82 to +15.63 |
| Baseline | 30–40% | 25 | 37.18% | 32.00% | -5.18 | -19.98 to +14.41 |
| Baseline | 40–50% | 98 | 45.99% | 44.90% | -1.09 | -10.56 to +8.76 |
| Baseline | 50–60% | 109 | 54.26% | 58.72% | +4.46 | -4.93 to +13.25 |
| Baseline | 60–70% | 21 | 62.79% | 66.67% | +3.87 | -17.42 to +20.01 |
| Baseline | 70–80% | 7 | 72.91% | 85.71% | +12.81 | -24.22 to +24.53 |
| Adjusted | 0–10% | 5 | 9.41% | 0.00% | -9.41 | -9.41 to +34.04 |
| Adjusted | 10–20% | 7 | 17.96% | 28.57% | +10.61 | -9.74 to +46.15 |
| Adjusted | 20–30% | 18 | 25.58% | 33.33% | +7.75 | -9.30 to +30.67 |
| Adjusted | 30–40% | 35 | 35.83% | 42.86% | +7.02 | -7.85 to +23.31 |
| Adjusted | 40–50% | 49 | 45.64% | 46.94% | +1.30 | -11.94 to +14.98 |
| Adjusted | 50–60% | 54 | 55.43% | 50.00% | -5.43 | -18.32 to +7.45 |
| Adjusted | 60–70% | 51 | 64.59% | 64.71% | +0.12 | -13.60 to +11.77 |
| Adjusted | 70–80% | 29 | 74.10% | 62.07% | -12.04 | -30.10 to +3.21 |
| Adjusted | 80–90% | 9 | 82.69% | 55.56% | -27.14 | -56.03 to -1.57 |
| Adjusted | 90–100% | 8 | 92.61% | 87.50% | -5.11 | -39.70 to +5.15 |

### 2026–27 team-scores-first holdout

| Forecast | Bin | Games | Mean | Observed | Error (pp) | 95% interval (pp) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 30–40% | 20 | 36.70% | 45.00% | +8.30 | -10.88 to +29.09 |
| Baseline | 40–50% | 114 | 45.67% | 57.02% | +11.35 | +2.18 to +20.06 |
| Baseline | 50–60% | 112 | 54.06% | 56.25% | +2.19 | -7.05 to +11.02 |
| Baseline | 60–70% | 19 | 64.39% | 73.68% | +9.29 | -13.18 to +23.80 |
| Adjusted | 20–30% | 7 | 27.56% | 14.29% | -13.27 | -24.99 to +23.75 |
| Adjusted | 30–40% | 25 | 36.66% | 48.00% | +11.34 | -6.63 to +29.84 |
| Adjusted | 40–50% | 96 | 45.44% | 55.21% | +9.77 | -0.19 to +19.33 |
| Adjusted | 50–60% | 96 | 54.95% | 61.46% | +6.50 | -3.49 to +15.62 |
| Adjusted | 60–70% | 31 | 63.73% | 58.06% | -5.66 | -22.96 to +9.86 |
| Adjusted | 70–80% | 10 | 72.61% | 80.00% | +7.39 | -23.59 to +21.72 |

## Tip tail, home orientation, and conservative refit

The 2025–26 home-tip 60–70% bin covered 61 games from November 20 to April 12. Raw jump winner and loser IDs agreed with the reviewed records in every game. Team scoring additions to the raw home and away score columns confirmed orientation in all 1,224 normalized games. The diagnostic uses score changes because the feed's shot-side field says left or right on the court.

| Actual home jumper | Games | Home tip wins | Mean home forecast |
| --- | ---: | ---: | ---: |
| Wendell Carter Jr. | 16 | 15 | 62.21% |
| Victor Wembanyama | 14 | 14 | 66.08% |
| Mark Williams | 12 | 10 | 63.12% |
| Remaining jumpers | 19 | 15 | 61.69% |

The three leaders accounted for 42 games and 39 wins. The remaining 19 also ran high at 78.95% observed. Only one exact jumper pair appeared twice. The bin had one game in November, four in December, 18 in January, 14 in February, 17 in March, and seven in April.

<details>
<summary>All 61 audited games and opening jumpers</summary>

| Date (Central) | Game ID | Away jumper | Home jumper | Home forecast | Winner |
| --- | --- | --- | --- | ---: | --- |
| 2025-11-20 | 0022500264 | Ivica Zubac (LAC) | Wendell Carter Jr. (ORL) | 61.75% | Home |
| 2025-12-01 | 0022500314 | Nikola Vučević (CHI) | Wendell Carter Jr. (ORL) | 62.18% | Home |
| 2025-12-13 | 0022501229 | Karl-Anthony Towns (NYK) | Wendell Carter Jr. (ORL) | 61.35% | Away |
| 2025-12-14 | 0022501219 | Myles Turner (MIL) | Nic Claxton (BKN) | 61.09% | Home |
| 2025-12-18 | 0022500378 | Quinten Post (GSW) | Mark Williams (PHX) | 61.54% | Home |
| 2026-01-01 | 0022500471 | Alperen Sengun (HOU) | Nic Claxton (BKN) | 60.91% | Away |
| 2026-01-02 | 0022500483 | Maxime Raynaud (SAC) | Mark Williams (PHX) | 60.26% | Home |
| 2026-01-04 | 0022500495 | Micah Potter (IND) | Wendell Carter Jr. (ORL) | 60.74% | Home |
| 2026-01-09 | 0022500533 | Joel Embiid (PHI) | Wendell Carter Jr. (ORL) | 62.45% | Home |
| 2026-01-09 | 0022500538 | Karl-Anthony Towns (NYK) | Mark Williams (PHX) | 62.33% | Home |
| 2026-01-09 | 0022500541 | Myles Turner (MIL) | Deandre Ayton (LAL) | 63.34% | Home |
| 2026-01-11 | 0022500554 | Myles Turner (MIL) | Aaron Gordon (DEN) | 61.31% | Home |
| 2026-01-11 | 0022500555 | Alex Sarr (WAS) | Mark Williams (PHX) | 61.72% | Home |
| 2026-01-15 | 0022500578 | Jaren Jackson Jr. (MEM) | Wendell Carter Jr. (ORL) | 60.41% | Home |
| 2026-01-15 | 0022500582 | Myles Turner (MIL) | Victor Wembanyama (SAS) | 66.76% | Home |
| 2026-01-16 | 0022500588 | Derik Queen (NOP) | Jay Huff (IND) | 61.04% | Home |
| 2026-01-17 | 0022500598 | Naz Reid (MIN) | Victor Wembanyama (SAS) | 61.81% | Home |
| 2026-01-18 | 0022500607 | Scottie Barnes (TOR) | Deandre Ayton (LAL) | 62.28% | Home |
| 2026-01-22 | 0022500627 | Moussa Diabaté (CHA) | Wendell Carter Jr. (ORL) | 62.26% | Home |
| 2026-01-25 | 0022500654 | Derik Queen (NOP) | Victor Wembanyama (SAS) | 68.55% | Home |
| 2026-01-25 | 0022500655 | Bam Adebayo (MIA) | Mark Williams (PHX) | 61.82% | Away |
| 2026-01-29 | 0022500685 | Jalen Duren (DET) | Mark Williams (PHX) | 63.38% | Home |
| 2026-01-30 | 0022500687 | Scottie Barnes (TOR) | Wendell Carter Jr. (ORL) | 63.08% | Home |
| 2026-02-01 | 0022500709 | Ivica Zubac (LAC) | Mark Williams (PHX) | 65.08% | Away |
| 2026-02-04 | 0022500730 | Cason Wallace (OKC) | Victor Wembanyama (SAS) | 65.48% | Home |
| 2026-02-05 | 0022500739 | Draymond Green (GSW) | Mark Williams (PHX) | 66.27% | Home |
| 2026-02-06 | 0022500744 | Derik Queen (NOP) | Rudy Gobert (MIN) | 61.09% | Away |
| 2026-02-07 | 0022500749 | Daniel Gafford (DAL) | Victor Wembanyama (SAS) | 66.59% | Home |
| 2026-02-07 | 0022500754 | Joel Embiid (PHI) | Mark Williams (PHX) | 63.50% | Home |
| 2026-02-09 | 0022500764 | Myles Turner (MIL) | Wendell Carter Jr. (ORL) | 64.09% | Home |
| 2026-02-10 | 0022500773 | Daniel Gafford (DAL) | Mark Williams (PHX) | 65.75% | Home |
| 2026-02-11 | 0022500777 | Myles Turner (MIL) | Wendell Carter Jr. (ORL) | 65.29% | Home |
| 2026-02-21 | 0022500815 | Maxime Raynaud (SAC) | Victor Wembanyama (SAS) | 61.50% | Home |
| 2026-02-24 | 0022500833 | Daniel Gafford (DAL) | Nic Claxton (BKN) | 60.36% | Home |
| 2026-02-24 | 0022500839 | Neemias Queta (BOS) | Mark Williams (PHX) | 61.41% | Home |
| 2026-02-26 | 0022500852 | Alperen Sengun (HOU) | Wendell Carter Jr. (ORL) | 60.20% | Home |
| 2026-02-28 | 0022500864 | Alperen Sengun (HOU) | Bam Adebayo (MIA) | 60.06% | Away |
| 2026-03-01 | 0022500870 | Myles Turner (MIL) | Matas Buzelis (CHI) | 61.84% | Home |
| 2026-03-05 | 0022500899 | Daniel Gafford (DAL) | Wendell Carter Jr. (ORL) | 60.25% | Home |
| 2026-03-05 | 0022500904 | Jalen Duren (DET) | Victor Wembanyama (SAS) | 65.46% | Home |
| 2026-03-06 | 0022500913 | Brook Lopez (LAC) | Victor Wembanyama (SAS) | 63.85% | Home |
| 2026-03-08 | 0022500927 | Alperen Sengun (HOU) | Victor Wembanyama (SAS) | 68.44% | Home |
| 2026-03-09 | 0022500932 | Olivier-Maxence Prosper (MEM) | Nic Claxton (BKN) | 61.79% | Home |
| 2026-03-10 | 0022500938 | Alex Sarr (WAS) | Bam Adebayo (MIA) | 60.73% | Home |
| 2026-03-10 | 0022500937 | Jalen Duren (DET) | Nic Claxton (BKN) | 60.11% | Away |
| 2026-03-10 | 0022500942 | Neemias Queta (BOS) | Victor Wembanyama (SAS) | 64.98% | Home |
| 2026-03-12 | 0022500955 | Alex Sarr (WAS) | Wendell Carter Jr. (ORL) | 62.79% | Home |
| 2026-03-12 | 0022500957 | Myles Turner (MIL) | Kel'el Ware (MIA) | 63.23% | Home |
| 2026-03-14 | 0022500973 | Moussa Diabaté (CHA) | Victor Wembanyama (SAS) | 67.95% | Home |
| 2026-03-19 | 0022501013 | Oso Ighodaro (PHX) | Victor Wembanyama (SAS) | 65.54% | Home |
| 2026-03-21 | 0022501031 | Myles Turner (MIL) | Oso Ighodaro (PHX) | 63.75% | Home |
| 2026-03-23 | 0022501046 | Myles Turner (MIL) | Brook Lopez (LAC) | 62.88% | Home |
| 2026-03-30 | 0022501094 | Matas Buzelis (CHI) | Victor Wembanyama (SAS) | 68.72% | Home |
| 2026-03-30 | 0022501098 | Tristan Vukcevic (WAS) | Deandre Ayton (LAL) | 61.49% | Home |
| 2026-04-01 | 0022501107 | Onyeka Okongwu (ATL) | Wendell Carter Jr. (ORL) | 61.85% | Home |
| 2026-04-04 | 0022501129 | Anthony Gill (WAS) | Bam Adebayo (MIA) | 60.37% | Home |
| 2026-04-06 | 0022501144 | Jalen Duren (DET) | Wendell Carter Jr. (ORL) | 62.32% | Home |
| 2026-04-06 | 0022501146 | Joel Embiid (PHI) | Victor Wembanyama (SAS) | 69.44% | Home |
| 2026-04-07 | 0022501157 | Alperen Sengun (HOU) | Mark Williams (PHX) | 64.42% | Home |
| 2026-04-08 | 0022501159 | Naz Reid (MIN) | Wendell Carter Jr. (ORL) | 64.37% | Home |
| 2026-04-12 | 0022501195 | Derik Queen (NOP) | Joan Beringer (MIN) | 64.40% | Home |

</details>

The raw home-tip average was 50.08% forecast versus 52.81% observed in 2025–26 and 50.26% versus 51.32% in the partial 2026–27 replay. Fit the home offset with slope fixed at one, then add a slope with penalty `20 × (slope − 1)² / 2` to the summed training loss. The term takes the opposite sign for an away forecast, which keeps complementary probabilities and one observation per game. The previous intercept was already an implicit home term because all outcomes were home-oriented.

Run `scripts/recalibrateNbaFirstBasketTip.ts <fit-replay.json> <holdout-replay.json>` for the home-only diagnostic and penalized candidate. Fit on the same 1,208 audited 2025–26 games. Treat the 265 partial 2026–27 games as a reused diagnostic cohort because the previous candidate was already scored on it.

| Candidate | Home offset, log-odds | Slope | Tip log loss | Paired tip gain, 95% interval |
| --- | ---: | ---: | ---: | --- |
| Baseline | 0 | 1 | 0.66012 | — |
| Home term only | +0.11124 | 1 | 0.66044 | −0.00032 (−0.00688 to +0.00613) |
| Penalized slope and home term | +0.11179 | 1.64721 | 0.65400 | +0.00613 (−0.00770 to +0.01936) |

The penalized candidate's 40–50% bin was 45.36% forecast versus 44.62% observed (65 games, −0.75 pp). Its 50–60% bin was 55.13% versus 52.94% (85 games, −2.19 pp). Team-scores-first log loss fell from 0.68826 to 0.68506 (paired gain +0.00320, 95% interval −0.00119 to +0.00762). A five-point shock to tip probability moved team-scores-first by 1.62 points on average, with the other simulation draws fixed.

**Release rule for the next untouched holdout.** Require a positive paired log-loss gain with its 95% interval above zero on 600 or more held-out games, or absolute gap within two percentage points in both the 40–50% and 50–60% bins. The current replay meets neither criterion. The complete closing-field comparison remains a separate gate. Keep the live tip model, usage prior 70, and Lean cap. Staging collection can proceed while this research continues.

**Earlier raw jump seasons.** The 2023–24 and 2024–25 archives each contain 1,230 regular-season games, with explicit opening jumper IDs in 1,226 and 1,227 games respectively. Joining the raw opening evidence to the recorded starting fives bound 1,226 and 1,225 games for those seasons. These records are available as historical development or chronological replay inputs. They were excluded from this fit and do not count as new games for the prospective holdout. The older derived play tables lack CDN action types and timestamps, so a full opening-window replay needs the raw action adapter and shot/possession reconciliation.

## Operational safeguards

The single collector reserves the maximum possible charge on disk before each paid request. It stops at 45 credits per game or 675 per Central-time slate by default, and verifies at least 100 credits remain after the next request using the quota-free sports endpoint. A missing balance stops paid requests. A lost response leaves the conservative debit in place. The reserve check uses the latest provider balance and cannot lock out other clients using the same API key.

Below 64 MiB free, the worker sends a low-disk alert, skips the collector, and withholds the success heartbeat. A failed collection or unreadable quota also withholds the heartbeat. The worker suppresses repeat disk alerts until space recovers. The dead-man receiver and alert delivery require a live endpoint test after deployment.

Quote archives retain only event, bookmaker, market, outcome and timestamp fields. They exclude configured secrets, request URLs, and provider exceptions. Route telemetry records the event ID and confirmed, unconfirmed, unknown, or excluded status without recording quote values or user identifiers. The archive separately reports the confirmation rate among observed collector pricing attempts. Unknown statuses stay outside the rate denominator. The live API deploy checked on November 26 still contains the legacy history route and has no First Basket pricing endpoint, so there is no production pricing-time rate yet.

The Odds API quota documentation: https://the-odds-api.com/liveapi/guides/v4/index.html#response-headers

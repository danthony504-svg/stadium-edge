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

On an isolated backend, mount a writable durable `NBA_FIRST_BASKET_ARCHIVE_DIR` shared by the API and a single collector. Configure the normalized lineup capture path and existing Odds API credentials. Run `scripts/collectNbaFirstBasket.ts --watch` to record the provider's complete response for every observed request, confirmed lineups, scratch revisions, and provider quota headers. The app reads archived prices in this mode, avoiding a parallel upstream polling stream. With only a lineup feed, the collector can archive lineups without an Odds API key. There are no provider requests outside the final 45 minutes.

Leave `NBA_FIRST_BASKET_FAST_RESERVE` unset for three-minute odds polling. A positive reserve allows one-minute polling in the final ten minutes only while a current provider quota reading leaves the reserve after the next request. Market counts and cold starts can vary. With all three markets returned in one region, continuous one-minute polls in the last ten minutes can reach 66 total credits per game on a stable lineup versus 45 at the default cadence. Scratches can add requests to both schedules. `scripts/collectNbaFirstBasket.ts --week YYYY-MM-DD` reports seven Central-time slate days, separating unobserved days and calls without quota headers from measured credits.

Run `scripts/tuneNbaFirstBasket.ts <data.json>` to compare strengths using chronological folds and conditional first-team-field-goal scorer log loss. The final time block is excluded from selection and reports the selected strength against the baseline. Only source observations available before the forecast enter the model. Keep the current prior until this has run on real data.

Run stage one on at least a season of verified play-by-play and as-of lineups. Review the observed size and absolute error in each calibration bin against the two-percentage-point target. Then collect a few hundred games with complete closing fields and run the paired closing comparison. The backtest can use `--archive` with normalized `history` and `finals`, and `--closing` enables paired market scoring. Grades are capped at Lean in code pending real calibration and closing validation.

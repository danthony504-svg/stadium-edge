# Coach spread calibration release rule

Coach holds all spreads pending calibration. Keep the Check line list separate from the ticket. Apply the release decision per sport and market cohort, starting with NHL puck lines and large college spreads. Freeze the model version, cohort definitions, thresholds, and date split before looking at holdout results.

- Use at least 500 distinct settled games per sport and cohort from an untouched chronological holdout. For college, report football and basketball separately and use absolute lines of 20 points or more for the large-spread cohort. Select one predeclared side and quote per game for the primary analysis. Record pushes separately and use the same settlement rules for market and model.
- Use fixed 10-point probability bins. Require at least 100 games per bin before enabling that band. Require the absolute difference between average predicted cover probability and observed cover frequency to be at most 5 percentage points in each enabled bin and in the cohort overall. Require a game-level 95% bootstrap interval for the signed gap to lie wholly within ±10 points. Report every band and name the worst absolute gap, with its game count and interval. A failed band cannot be cleared by the overall average. Leave unverified bands and cohorts withheld.
- Save the versioned input manifest, pregame book, price, line, timestamp, model probability, settlement, exclusions, bin counts, intervals, and comparison against no-vig closing probabilities. Compare log loss and Brier score against the existing model and closing market. Record the release decision against the saved report.
- Evaluate hockey goal-margin candidates and fat-tailed college margin candidates on earlier data. Use only pregame inputs and apply the holdout gate after model selection.

## Closing-line check

Require a second holdout test on the predeclared edge-qualified selections. Compare the same side, handicap and settlement rules against the no-vig closing quote. Report unmatchable closing rungs as missing and keep the cohort withheld until every edge-qualified selection has a matched close. For release, require the game-level 95% paired bootstrap lower bound to exceed zero for both price-based closing-line value and observed net return at the actual pregame selection price. Report results per enabled band and overall. Calibration alone cannot clear the edge gate. Use `evaluateSpreadRelease` in `scripts/coach-spread-release-check.mjs` to run both checks on validated, matched holdout rows. Supply probabilities conditional on a non-push result and save the returned report with its input manifest.

## Collection planning

Illustrative rates are usable settled games with complete quote and closing records per active week. At 45–55 NHL puck-line games per week, 500 takes about 10–12 weeks. At 8–15 large college football spreads per week, it takes about 34–63 active weeks. At 12–25 large college basketball spreads per week, it takes about 20–42 active weeks. Offseason gaps and probability-band minimums can extend those windows. Historical backfill can shorten the calendar wait.

Set a review 30 calendar days after data intake starts and record the date in the cohort manifest. At that review, publish actual coverage and an expected decision date per cohort, using measured usable-game rates and archive coverage. Keep the cohort withheld if its gate is still open.

## Board snapshot retention

Keep the most recent five timing snapshots on-device for up to seven days. Expired snapshots are removed on the next read or write. The board allowlist contains fixture and athlete metadata, public sportsbook quotes, and slate information. It omits prompts, chat history, account data, device identifiers and prepared-context payloads. Timing metadata includes the app update ID and a generated request ID for reconciliation. Sharing is manual.

## Recovery status

The earlier duplicate-player skipping, NBA opponent-evidence prewarm, and three-distribution scan from `1228efb` were rebuilt independently on this branch. The reported 57.64-second 15-leg result is not reproducible from this branch or the saved evidence. The original 132.2-second run also lacks a comparable board and stage trace.

# Coach spread calibration release rule

Coach holds all spreads pending calibration. Keep the Check line list separate from the ticket. Apply the release decision per sport and market cohort, starting with NHL puck lines and large college spreads. Freeze the model version, cohort definitions, thresholds, and date split before looking at holdout results.

- Use at least 500 distinct settled games per sport and cohort from an untouched chronological holdout. For college, report football and basketball separately and use absolute lines of 20 points or more for the large-spread cohort. Select one predeclared side and quote per game for the primary analysis. Record pushes separately and use the same settlement rules for market and model.
- Use fixed 10-point probability bins. Require at least 100 games per bin before enabling that band. Require the absolute difference between average predicted cover probability and observed cover frequency to be at most 5 percentage points in each enabled bin and in the cohort overall. Require a game-level 95% bootstrap interval for the signed gap to lie wholly within ±10 points. Leave unverified bands and cohorts withheld.
- Save the versioned input manifest, pregame book, price, line, timestamp, model probability, settlement, exclusions, bin counts, intervals, and comparison against no-vig closing probabilities. Compare log loss and Brier score against the existing model and closing market. Record the release decision against the saved report.
- Evaluate hockey goal-margin candidates and fat-tailed college margin candidates on earlier data. Use only pregame inputs and apply the holdout gate after model selection.

## Recovery status

The earlier duplicate-player skipping, NBA opponent-evidence prewarm, and three-distribution scan from `1228efb` are unbuilt on this branch. The reported 57.64-second 15-leg result is not reproducible from this branch or the saved evidence. The original 132.2-second run also lacks a comparable board and stage trace.

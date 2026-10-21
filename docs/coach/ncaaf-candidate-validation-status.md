# NCAAF recovery: offline candidate and audit

Status: implemented for evaluation only; not calibrated, not registered in the
live simulator, not eligible for Coach grades. The NCAAF availability/P0 flags
and production NFL/NHL paths remain unchanged.

## Defect reproduced

The existing nfl-drive engine passes per-game `teamMean` values to a function
named for points per drive. Above approximately 11.8, both scoring rates cap.
Common 18–35 point team means therefore produce identical TD/FG rates. Its
home-first clock-bonus logic also does not represent simultaneous game state.

## Candidate

`ncaafCandidate.ts` separates per-game means from points per drive. A smooth
exponential tilt over 0/3/7-point drive outcomes matches the requested mean.
Rates are solved twice, before draws, not 20,000 times. Independent seeded
randomness does not replace Math.random. Sparse venue samples fall back to
larger overall samples; insufficient samples reject the candidate.

Defaults (12 drives and .3/.7 relative field-goal/touchdown prior weights) are
explicit **unfitted experimental parameters**, not validated college football
coefficients. No inferred QB injury haircut or defense/EPA coefficient is used.
The candidate models regulation only; full-game quotes, overtime, two-point
conversions, safeties, variance, drive dependence, tempo and matchup/injury
adjustments remain unvalidated. Matching a mean does not validate probabilities.

## Checks completed

- Six candidate tests: mean recovery over 0–84 points, no ordinary-score rate
  saturation, 10k draws, controlled +3/-6 offensive proxies moving home -3.5
  cover at least two percentage points, sparse samples, seeded reproducibility.
- Three offline audit tests plus six existing legacy-engine diagnostic tests:
  15 pass. No historical accuracy claim derives from those synthetic fixtures.
- 31 existing client P0/build tests pass. Gate stays closed.
- API typecheck passes. Local 10k candidate timing approximately 4–6ms in warmed
  runs; this is isolated CPU measurement, not a live Coach latency benchmark.
- Zero additional Coach network calls or CPU work: candidate/audit have no
  imports in production entry points.

## Frozen forecast audit

Run from artifacts/api-server:

    node --import ./test/register-hooks.mjs scripts/validateNcaafForecasts.ts INPUT.json

Input is an array of `NcaafForecast` records. It requires event/book/quote/line,
selection, source URL, model version, prediction/history cutoff before kickoff,
settlement after kickoff, predicted and no-vig market probabilities, and binary
outcome. Push/void rows, duplicate forecasts, missing exact lines and regulation
settlement are excluded with explicit counts. Reports Brier score, log loss,
decile calibration and per-market breakdown versus the supplied market baseline.

The audit cannot authenticate an arbitrary supplied journal or certify provider
fields by itself. Source records must be frozen and reviewed separately. Quote
probabilities must bind the same selection/line/book and have verified timestamps.
No minimum sample/tolerance or production approval is silently invented.

With no input, the runner exits 2 and reports no usable frozen forecasts,
missing multi-season holdout, overtime, matchup/injury validation and acceptance
review. `productionReady` remains false even with supplied rows; this report is
not an automatic mechanism for changing a client flag.

## Remaining activation evidence

No historical forecast/closing-line dataset or CFBD/Odds API credential was
available in this workspace. That does not assert credentials are absent from
the deployed server. CFBD documents historical game/line data and bearer API-key
access at https://api.collegefootballdata.com/data-availability and
https://api.collegefootballdata.com/authentication . Provider field coverage must
be inspected; historical line availability alone does not prove a timestamped
closing price or leakage-free pregame history.

Next: obtain frozen source records, calibrate on a training period, freeze
parameters, evaluate on separate later seasons and all requested markets,
validate injury/matchup/overtime behavior, and complete the recovery plan's
acceptance review before test rollout. No production deployment, OTA or native
build is part of this change.

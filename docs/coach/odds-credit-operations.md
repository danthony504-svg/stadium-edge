# Odds API quota controls

The November 2026 outage was confirmed by the provider's `OUT_OF_USAGE_CREDITS` code. The dashboard total cannot establish which caller spent the credits or whether any usage was unauthorized. Review the provider's usage details after sign-in and compare any unexplained periods against our request logs. Keep keys in provider and service secret settings.

## Configure and verify

- Set `ODDS_MONTHLY_CREDIT_LIMIT=5000000` for the current paid plan. Structured warnings fire at 70% and 90% of reported monthly usage. Route those warnings to the approved alert destination before using them as operational alerts.
- Set `ODDS_DAILY_BUDGET_<CALLER>` separately for scheduled refresh, Coach, app browse, admin tests, and live probes. Caps reserve the worst-case requested market by region cost before each call. Use `REDIS_URL` for shared atomic enforcement across the service and worker. Without it caps are per process. Actual billed credits come from the response header rather than the reservation. Zero can disable paid requests for a caller.
- Set `ODDS_SCHEDULED_REFRESH_DISABLED=1` on both the API and the Coach slate worker to pause those jobs. Scheduled prebuild prop requests are limited to events starting in the next six hours. Already started games are excluded from prebuild. The existing shared cache and same-process in-flight merge continue to serve matching scope and key tier without a new provider call.
- Configure `ODDS_TEST_API_KEY` and `ODDS_DIAGNOSTIC_TOKEN` in staging. Authorized prop diagnostics use the test key, separate cache and caller budget. For production recovery, choose one game from the ESPN-backed schedule and poll it with `marketScope=core` only after verifying that the limited endpoint is deployed, and stop after the first priced response.
- Aggregate the `odds provider usage` logs by UTC usage period, caller and key tier. Sum `cost` for provider responses and count responses with missing headers separately. Reconcile the total to the provider dashboard before choosing a plan. Standalone capture scripts and the first-basket collector need the same accounting before entering production. A request without a trusted diagnostics label uses the normal public route and production key.

## First-basket credit week

Reserve credits inside the production budget for initial collection. At 45–66 credits per game, an 11-game night costs 495–726 credits. Seven such slates cost 3,465–5,082 before late-scratch refreshes. With a 20% reserve, cap this scenario at 6,100 credits for the week and reserve up to 875 on an 11-game day. Recompute for the actual slate and cap refreshed quotes inside the same reservation. Start the week after live caller totals are reconciled, alert routing is verified, and staging confirms that the collector can stop at its cap. These are planning figures. The collector is not wired to this branch's credit limits.

## Rotation and reconciliation

Before rotation, capture the dashboard counter and available activity for each key. Create replacement keys, update the API, collector, CI and local secret stores that use each key, then apply the production secret and verify a successful provider call with the replacement. Revoke exposed keys after verification and take a second dashboard reading. If quota exhaustion prevents a paid verification, check a zero-credit endpoint and record that paid verification is pending. Never record key values in the audit.

Collect at least 72 hours of live logs before choosing a plan. Take start and end readings in the same quota period and key generation. Run `reconcileOddsCredits` from `scripts/reconcile-odds-credits.mjs` with the dashboard readings and normalized production usage rows. Compare the signed delta, unattributed logs and missing-cost rows. Investigate refresh jobs, Coach builds and possible credential use first. The gap alone cannot identify a caller.

Configure `ODDS_CREDIT_ALERT_WEBHOOK_URL` only with the approved HTTPS destination. Verify a test alert at the destination before relying on threshold notifications. The diagnostic key is isolated from production callers and has a hard shared ceiling of 25 reserved credits per UTC day, or a lower configured budget. Use Redis for cross-process enforcement.

### December reconciliation window

Start at the reset on November 30, 2026 at 6:00 p.m. Central (December 1 at 00:00 UTC). Capture the dashboard counter and key generation. At 24 hours, capture the second counter and reconcile production logs from the same interval. At 72 hours, capture the final counter and repeat. If a key changes or instrumentation starts mid-window, report that incomplete coverage explicitly. Diagnostics require a working Redis reservation before every upstream call, even on routes that would normally cost zero credits.

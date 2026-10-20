# Stadium Edge stabilization — October 20, 2026

This batch closes code defects and prepares a preview. It does not claim an iPhone rollout, Apple offer activation, new native release, or validated prediction feeds.

## Changes

- Coach optional enrichment shares an eight-second ceiling and preserves eighteen seconds of the remaining request for scoring. Completed and abort-returned context survives; unavailable signals stay absent. The parent request deadline is not extended. Defense loading stops between batches on cancellation.
- Coach warmup/streaming now read the registered authentication getter. Previously a removed variable could throw inside a catch and silently send an anonymous request. Authenticated fetches now forward cancellation signals.
- Exact per-pass prop lookup now binds market/event/player/side/threshold/price/book and avoids repeated full-pool searches. Injury results are cached only within a scoring pass; posted-odds merge keys are built once per game. Equivalent posted wagers can be scored once at their best price without discarding distinct markets or audit quotes.
- Full-board prop deduplication includes sport, event, athlete, raw market, side, threshold, price and sportsbook. Team metadata keys include sport as well as provider ID.
- Player detail resolves player/opponent identity before defense calculations, avoiding a temporal-dead-zone access. Pick metadata carries the source player-team ID.
- Model Report is hidden with the disabled saved-slip UI. Its deep-link empty state no longer tells users to save unavailable slips. Slip-dependent notification switches follow the same feature flag. Existing saved data is not deleted.
- Push registration failure is visible to the caller. Expo acceptance, explicit rejection and unknown transport outcomes are distinct. Cron deduplication is per device, retries explicit rejections, preserves unknown claims to avoid duplicates and prunes dead tokens. Acceptance is not proof of iOS display; receipt polling is not added by this batch.
- Trial copy uses actual catalog duration when available and explains eligibility. Unknown duration never becomes an invented seven-day offer. Unknown paid products and unhandled webhook types do not overwrite access. Webhook event claims and entitlement writes share a transaction, allowing retry after a failed write.
- Native passkeys remain guarded before module loading. ClerkProvider receives only a complete adapter; Build 78 is not made passkey-capable by JavaScript. Existing Face ID functionality still requires phone verification.
- Corrected stale rubric-field reads and missing scanner style/context forwarding. Best-game-line selection sorts its input without mutating it. Notes preserve the delivered ticket's grade instead of replacing it with a newly computed grade.
- API/mobile source and fixture typing fixes retain strict checking. Tests are not excluded and production quality/provenance types are not weakened. Legacy fixtures now explicitly distinguish simulated evidence from unvalidated historical estimates.
- The API deploy workflow fails visibly when its Render hook is missing, rather than showing success after skipping deployment.

## Preserved safeguards

The 52% confidence and C+ floors, positive EV/edge checks, market locks, provider identity, exact 10k provenance, correlation limits and NCAAF game-line validation block remain. History alone does not authorize a player-prop seat. Production diagnostics remain hidden by the existing shared visibility policy.

## Validation and limits

Both full TypeScript checks and API bundle pass locally. The iOS export succeeds. The 534-test required reliability suite, 407 changed-path/visibility regressions, 75 auth/purchase/referral/notification feature tests and 38 API feature tests pass locally. These suites overlap and should not be added into a unique-test count. No test notification, Telegram alert or crash fixture is intentionally posted to production.

An unchanged checkout reproduced twenty failures in older tests. Stale history-only seating expectations were replaced with explicit fail-closed assertions; positive seating fixtures carry explicit exact-simulation evidence. An isolated PostgreSQL CI test exercises the actual subscription webhook, failed-write rollback, retry, duplicate handling, and unknown event/product preservation. Without localhost TEST_DATABASE_URL that test skips locally; a skip is not database verification.

One live automatic free-two-leg sample returned two normally qualified picks in 35.2 seconds (load 15.6s, enrichment 8.1s, scan 10.9s), A later sample returned 2/2 in 37.4s, and two other samples still returned 0/2 at ~41s. These are changing live boards, not a controlled benchmark. Profiling identified redundant odds-set construction, full-pool lookup and injury matching; per-pass indexes/caches now address these CPU costs. After the indexed lookup/cache changes, a sample returned 2/2 in 32.8s (17.7s load, 8.0s context, 6.6s scan). This is still above target. The 15–30s latency target and reliable completion under slow upstream responses remain open.

## External completion steps

| Work | Required evidence before calling it complete |
|---|---|
| Preview / iPhone | Publish the tested preview commit; confirm running update ID, free two-leg completion, market locks, grade/detail consistency and latency on the device. |
| Production OTA / Build 78 | Promote only after preview/device validation. No production OTA is published by this batch. |
| API deployment | Configure the actual Render deploy hook or deploy manually; verify health deploymentSha against the merged commit. Triggering a hook is not deployment proof. |
| Daily notifications | Verify cron heartbeat with its server key, opt-in token registration, fresh content, preferences, accepted push and actual iPhone receipt/tap destination. Unknown outcomes remain observable limitations. |
| Referral rewards | Apply migration, set durable key, load operator-verified Apple week/month offer inventory, enable program, test new-account attribution and both Apple redemptions/restore. Follow docs/referral-rewards.md. |
| Seven-day trial / purchases | Configure the intended Apple offer and eligibility; test eligible/ineligible purchase, cancel, renewal/expiry, restore and RevenueCat sync with real accounts. Approved products alone do not establish this. |
| Apple / Face ID / passkeys | New/returning-user, cancellation, reinstall and restore tests on supported binaries. Native passkeys require a later binary with the module. |
| Prediction improvements | Obtain authoritative pitch/pressure/coverage/minutes data and historical outcomes; measure calibration and holdout results before adding weights. Soccer/tennis weather effects and rest/travel/joint-ticket model weights remain unvalidated. Do not invent feeds or forecast confidence. |
| Build 79 | Complete physical-device/native-module matrix and release preflight before a new native build. |

Local credentials for Apple, Expo publishing, Render, production database, and protected cron status are not available here. Their absence locally does not prove they are absent in production. iOS also does not guarantee continued execution after the user closes the app; freshness must be maintained on the server and refreshed on foreground.

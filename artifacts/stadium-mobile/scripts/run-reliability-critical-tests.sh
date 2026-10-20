#!/usr/bin/env bash
# Critical Phase A reliability tests — required before production OTA publish.
# Emergency releases that skip a new publish use rollback/heal workflows instead.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MOBILE="$ROOT/artifacts/stadium-mobile"
API="$ROOT/artifacts/api-server"

echo "== Mobile crash / ScoreBreakdown / startup / global handlers =="
(
  cd "$MOBILE"
  # Never POST crash fixtures to production ingest (domain may be set in CI/agents).
  export CRASH_REPORTING_DISABLED=1
  export NODE_ENV=test
  # register-hooks rewrites relative .ts / extensionless imports for node:test
  node --import ./test/register-hooks.mjs --test \
    lib/crashReporter.test.ts \
    lib/crashReportingGate.test.ts \
    lib/crashDiagnostics.test.ts \
    lib/scoreBreakdownCrash.test.ts \
    lib/startupCrashPath.test.ts \
    lib/installGlobalCrashHandlers.test.ts \
    lib/coachPropAudit.test.ts \
    lib/coachSmallTicketCompletion.test.ts \
    lib/coachReliabilityReporter.test.ts
  node --import ./test/register-hooks.mjs --test \
    --test-name-pattern='normalizeCombinedPickScore|ScoreBreakdown crash|mixed list|reproduces device|fix:|mixed VirtualizedList' \
    lib/pickScore.test.ts
)

echo "== API reliability sanitize / Telegram / abuse / gates / Coach / health =="
(
  cd "$API"
  node --import ./test/register-hooks.mjs --test \
    test/reliabilitySanitize.test.ts \
    test/reliabilityCrashMeta.test.ts \
    test/reliabilityAbuse.test.ts \
    test/telegramAlert.test.ts \
    test/reliabilityCrashStorePolicy.test.ts \
    test/reliabilityBodyLimit.test.ts \
    test/reliabilityOtaWorkflowGates.test.ts \
    test/reliabilityPolicy.test.ts \
    test/coachReliability.test.ts \
    test/soccerTeamHistory.test.ts \
    test/soccerScoreboardPaths.test.ts \
    test/pushDelivery.test.ts \
    test/dailyCoachNotification.test.ts \
    test/subscriptionSync.test.ts \
    test/revenueCatSubscriber.test.ts \
    test/reliabilityHealth.test.ts
)

echo "== Stage 3 TD sim mapping / Monte Carlo / provenance contracts =="
(
  cd "$API"
  node --import ./test/register-hooks.mjs --test \
    test/reliabilityPhaseASimPaths.test.ts \
    test/stage3TdSimMapping.test.ts \
    test/footballPropStatValue.test.ts \
    test/footballScoringOpportunities.test.ts \
    test/propCatalogParity.test.ts \
    test/anytimeTdModel.test.ts \
    test/monteCarlo.test.ts \
    test/ncaafHistoricalAcceptance.test.ts \
    test/nflDriveSimCaps.test.ts
)
(
  cd "$MOBILE"
  export CRASH_REPORTING_DISABLED=1
  export NODE_ENV=test
  node --import ./test/register-hooks.mjs --test \
    lib/anytimeTdPropModel.test.ts \
    lib/coachPropProbabilityProvenance.test.ts \
    lib/coachPropSimProvenance.contract.test.ts \
    lib/boardFootballMixSim.test.ts
)

echo "== Coach ticket qualification / staging / absolute budget =="
(
  cd "$MOBILE"
  export CRASH_REPORTING_DISABLED=1
  export NODE_ENV=test
  node --import ./test/register-hooks.mjs --test \
    lib/coachFootballPropsOnly.test.ts \
    lib/coachPropSimCoverage.test.ts \
    lib/binaryPropMarket.test.ts \
    lib/propPoolIdentity.test.ts \
    lib/pickScoreContextIdentity.test.ts \
    lib/coachAskMarketFilter.test.ts \
    lib/coachAskMarketFilter.extra.test.ts \
    lib/coachPropBoardCoverage.test.ts \
    lib/chatContextPriority.test.ts \
    lib/lockedMarketQualityShortfall.test.ts \
    lib/coach/session.test.ts \
    lib/coach/scanCleanupContract.test.ts \
    lib/coachAskTeamScope.test.ts \
    lib/coachAutoFreePreview.test.ts \
    lib/coachContextBudget.test.ts \
    lib/coachPropQuoteCandidates.test.ts \
    lib/coachPremiumGate.test.ts \
    lib/totalBreakdown.test.ts \
    lib/coachP0UnvalidatedTotals.test.ts \
    lib/postedMarketCategories.test.ts \
    lib/coachTourPlacement.test.ts \
    lib/coachPerfDiagnostics.test.ts \
    lib/coach/coachRequestDeadline.test.ts \
    lib/coachPreSimGrounding.test.ts \
    lib/coachDeliveryGrounding.test.ts \
    lib/coachTicketHold.test.ts \
    lib/simMarketSupport.test.ts
)

echo "Reliability critical tests PASSED."

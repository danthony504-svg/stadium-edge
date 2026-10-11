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
    lib/installGlobalCrashHandlers.test.ts
  node --import ./test/register-hooks.mjs --test \
    --test-name-pattern='normalizeCombinedPickScore|ScoreBreakdown crash|mixed list|reproduces device|fix:|mixed VirtualizedList' \
    lib/pickScore.test.ts
)

echo "== API reliability sanitize / Telegram / abuse / gates =="
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
    test/reliabilityPolicy.test.ts
)

echo "Reliability critical tests PASSED."

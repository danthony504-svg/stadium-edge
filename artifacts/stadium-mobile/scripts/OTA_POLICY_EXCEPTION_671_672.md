# OTA policy exception scope — PR #671 & #672

**Status:** Document only. Do **not** request owner exception or publish OTA until slate ops + TestFlight marker are ready.

Policy source: `scripts/ota-release-policy.sh`.

---

## What needs an explicit owner exception?

| PR | Change | Strict policy bucket | Exception required? |
|---|---|---|---|
| **#671** | Require Clerk sign-in before Apple Subscribe / Restore; Plans pending-intent + auth `_layout` return wiring | **Authentication** + **routing/navigation** | **Yes** |
| **#672** | Password AutoFill / Strong Password `textContentType` + `autoComplete` on existing auth fields | Auth **screens** (labeled Authentication) but no session/bootstrap/Clerk key change | **Yes (conservative)** — or accept as UI-only if owner narrows policy |
| **#672** | AppleAuthButton post-auth `router.replace` → Plans (selection only; no auto-purchase) | **Navigation / routing** | **Yes** (even though Apple button is currently disabled) |

No exception needed for: Clerk instance keys, proxy URL, RevenueCat identity model, Coach selection/odds/grading/sims, NCAAF safeguards, Simulator V2 (unchanged in these PRs).

---

## Risks the exception would accept

If the owner waives policy for a **JS-only production OTA** on runtime **1.1.0**:

1. **Auth/routing regressions** without a new native binary — e.g. Plans return loop, subscribe gate false-negatives/positives, Autofill props confusing a field.
2. **Rollback limits** — OTA can republish/roll back to embedded, but cannot change baked native env; bad JS still requires a good update group or embedded rollback.
3. **#671 restore/purchase gate** — signed-out users cannot restore until sign-in; support must know this is intentional.
4. **#672 Apple path** — code path exists while `APPLE_SIGN_IN_ENABLED=false`; enabling Apple later without retest could auto-navigate incorrectly if intent storage is stale (mitigated: selection-only, no auto-purchase).
5. **No native entitlement** for new native modules — acceptable only because these PRs add none.
6. **Does not fix Coach slate emptiness** — server/cron/ops issue; shipping #671/#672 does not heal slate.

Exception does **not** authorize: Clerk `pk_live` cutover, RC identity migration, native build, forging `.ota-testflight-verified`, or bypassing qualification rules on Coach picks.

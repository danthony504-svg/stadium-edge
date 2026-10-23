# Production data-service repair — October 23, 2026

Production logs confirmed repeated ESPN 400 failures on the bulk odds route and
`relation live_steals does not exist` while persisting the longshot ledger.
Read-only catalog inspection also confirmed that subscription_events and the
four referral tables declared by the application were absent. The RevenueCat
webhook claims its event in subscription_events in the same transaction as an
entitlement update, so absence prevents that webhook transaction from succeeding.

## Repair

- Add an explicit, production-database-name-guarded create-only migration for
  subscription_events, live_steals, referral_accounts, referral_conversions,
  referral_offer_codes and referral_rewards. Preserve all existing tables/rows;
  no entitlement grants, offer-code generation, notification sends or fabricated
  historical ledger rows. Advisory transaction lock plus bounded lock/statement
  timeouts; failed transactions roll back before releasing the client.
- Replace rejected ESPN hyphenated date ranges in bulk odds, finals grading,
  golf grading and tennis with shared cached single-day fetches, at most four
  concurrent per window and an eight-second per-fetch timeout. Browse games uses
  the same daily cache. Partial failures remain missing evidence; all-day failure
  is explicit. Preserve distinct daily tournament payloads before callers dedupe
  individual competitions.
- Coalesce simultaneous cache misses for the same key; retain no rejected promise
  or stale result. Different keys remain independent.
- Correct the PR895 stop/budget-flush review finding: terminal flush forwards the
  same explicit single-event/few-game/college seat caps as normal finalization.

## Verification

- Final full API suite: 728 pass, 0 fail, 12 skip.
- Release-critical suite and final iOS Hermes export pass; 58 targeted mobile
  delivery/flush tests pass.
- Create-only SQL executed twice in PGlite with fixture rows preserved; verified
  webhook event uniqueness, referral checks and foreign keys. PGlite omits only
  the PostgreSQL advisory-lock statement, which is supported on production PG.
- Backend and mobile typechecks, API build, targeted terminal-flush tests pass.
- Applying the migration requires APPLY_OPERATIONAL_SCHEMA_MIGRATION=true for
  one deployment, verifying the production catalog, then resetting it to false.
  Source merge alone does not establish that production schema has changed.
- NCAAF model acceptance and the existing broad mobile test debt remain separate
  release blockers. This repair does not certify all sports' model accuracy.

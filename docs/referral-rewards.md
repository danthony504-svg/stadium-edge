# Verified friend rewards

Milestones approved for this release: 3 verified new accounts → one free week; 10 → one free month. Each milestone is claimable once per inviter. They are separate rewards (not a recurring reward every 3 or 10 shares). Sharing alone never increments a count.

## Implementation

- Registered server-side invite codes and an HTTPS landing page at `/invite/:code`. `/?ref=:code` redirects to that page. An account's existing 8-character code is preserved on registration if available; a collision gets a random replacement. Older links work after that inviter opens the updated Account page and registers their code.
- The landing page offers an App Store download, an explicit app deep link, and the code. An App Store installation does **not** preserve referral attribution automatically. Reopen the invite after installation or enter the displayed code in Account.
- Deep links retain the first valid invite locally for 7 days through sign-up/sign-in. Invite sign-up returns to Account, where it applies after authentication. Existing subscription return paths are preserved.
- The server reads the actual Clerk account and verified **primary** email. Invited accounts must be at most 7 days old, with an inviter who joined earlier. Referrers never receive friends' email addresses.
- Database uniqueness prevents repeated attribution, changing inviter, and reusing a verified email. Gmail dots/plus aliases normalize to the same fingerprint. Self-invites are rejected. Rate limits apply; these controls do not guarantee protection against organized abuse with distinct verified emails.
- Database advisory locks, row locks with SKIP LOCKED, and unique reward/offer constraints reserve an Apple code exactly once, even across processes. Empty/expired inventory does not consume a reward.
- Codes use authenticated AES-256-GCM encryption. A free entitlement is **not** manufactured on the client or written into RevenueCat/Apple subscription records. Apple redeems the assigned code; the existing StoreKit/RevenueCat verification/restore path grants access.
- Week and month Apple offers must be configured for the intended subscription in App Store Connect with the promised free duration and appropriate new/existing/expired subscriber eligibility. Apple displays renewal terms; this implementation does not pause, cancel, or directly extend paid subscriptions. Apple may limit multiple offer redemptions within a subscription group: configure distinct eligible offers and test both milestones before launch.

## Activation — backend AND mobile update required

1. Apply `lib/db/migrations/20261019_create_referrals.sql` to the target database, using the existing migration procedure. Drizzle schema definitions are included as well.
2. Generate a durable 32-byte secret and store its 64-character hex value as server-only `REFERRAL_REWARDS_KEY`. Keep it backed up: changing it breaks email deduplication and decryption of assigned offers.
3. Set `REFERRAL_PUBLIC_ORIGIN=https://stadium-edge.onrender.com` (or an HTTPS origin that actually serves this API's public invite route).
4. In App Store Connect, create **one-time-use** free-week and free-month subscription offer codes, for Stadium Edge app 6776024127. Load their Apple expiration dates. The code importer cannot validate Apple's duration, product, eligibility, storefront or redemption state; these are operator-verified settings.
5. Prepare a private JSON file **outside the repository** containing objects `{ "milestone": 3, "code": "<real Apple code>", "expiresAt": "<Apple expiry ISO timestamp>" }` and milestone 10 objects for the month. From `artifacts/api-server`, with the target DATABASE_URL and server key set, run `node --import ./test/register-hooks.mjs scripts/import-referral-offers.ts /secure/path/apple-offers.json`. Import is transactional and duplicate-safe. Never commit the input file.
6. Deploy the backend and set `REFERRAL_PROGRAM_ENABLED=true` only after offers and migrations are ready. The default is off. Before activation, the Account card truthfully says rewards are unavailable and shares the real App Store link instead of the broken API root.
7. Publish a preview mobile OTA and test with real new verified accounts: invite before install, reopen/code entry, credit, duplicate/self-invite rejection, both milestones and Apple redemption followed by restore. An assigned code is not proof that Apple redeemed it; UI calls it a redemption, never active free access.
8. Promote only after the preview and Apple redemption checks pass. No production deployment or OTA is performed by this change.

## Tests / operations

`Referral rewards CI` provisions an isolated localhost PostgreSQL service. It tests concurrent account registration, code collisions, duplicate attribution, self-invites, competing claims, independent milestones, expiration/empty inventory and account deletion, plus mobile link/auth tests, API bundle and iOS export.

Local integration tests require an explicit localhost TEST_DATABASE_URL. They create/drop only a dedicated test schema. With no test DB the integration suite is skipped, not claimed as a pass.

Account deletion removes the referral profile, rewards and direct account references. Used/reserved offers are never recycled. A keyed email fingerprint blocks reuse for 90 days after referred-account deletion to prevent immediate delete/recreate abuse. Expired fingerprints are cleared by the next attribution transaction; there is no background purge in this change, so an idle program can retain them longer. For a strict 90-day storage limit, configure a scheduled purge before activation. Conversion counts remain aggregate history. Include this purpose and retention period in the deployed Privacy Policy before activation.

Monitor stock in `referral_offer_codes` by milestone and expiry. Import new batches before they run out. A user with an already assigned expired code is directed to support; replace that reward's assignment transactionally with a fresh code rather than changing reward eligibility or recycling used inventory.

Apple offer codes: https://developer.apple.com/app-store/subscriptions/#offer-codes

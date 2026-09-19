---
name: Mobile soft subscription foundation (OTA-safe)
description: Entitlements + soft paywall without StoreKit/RevenueCat; do not hard-gate Coach or guest browse.
---

# Mobile soft subscription foundation (OTA-safe)

Stadium Edge mobile has a **preview** subscription layer that can ship over OTA
without a native rebuild.

## Plans (display only until StoreKit)
- Free trial — 7 days (everything unlocked)
- Go — $9.99 / week
- Pro — $29.99 / month

## What’s free forever (App Store 5.1.1(v))
Discover, Coach, Props, Slip, Weather, Fantasy — never hard-walled.

## Soft-gated after trial (needs plan / admin / promo)
Edge Lock, +500 Steals, Simulator, Model Report — full screens.
**AI Grade / Confidence / Edge tiles** on Coach (and other) pick cards — pick
text + odds + Add to slip stay free; metrics show a Pro unlock teaser.

## Admin unlock
Signed-in email matching `EXPO_PUBLIC_ADMIN_EMAILS` (comma-separated) gets full
Pro. Set in `eas.json` production env + OTA publish scripts.

## Promo codes / links / timing
Catalog in `lib/entitlements.ts`. Redeem on Plans/Account or
`https://<domain>/plans?promo=CODE`.

Per-code timing:
- `redeemFromMs` / `redeemUntilMs` — when the code may be **entered**
- `kind: "days"` — access lasts N days **after** redeem
- `kind: "until"` — access ends on a **fixed calendar date**
- `kind: "lifetime"` — never expires after redeem
- `maxRedeemsPerDevice` — local use cap (default 1). **Global** limited-use
  codes need a server; OTA-only cannot enforce cross-device caps.

Current codes:
- `7VXHVPOR` lifetime
- `KFXD4X2B` 7 days after redeem
- `KK48IZSN` 30 days after redeem
- `8VZV43WK` Pro until 2027-01-01 UTC
- `6EUSDWFI` flash: redeem only Sep 17–Oct 17 2026 UTC, then 7 days access

## Hard rules
- **Do not** hard-wall Coach / Discover / guest browse.
- **Do not** ship RevenueCat/StoreKit via OTA alone — needs native rebuild +
  `runtimeVersion` bump (see [apple-storekit-subscriptions.md](apple-storekit-subscriptions.md)).
- **Do not** touch `DeferredOtaRuntime` for billing work.

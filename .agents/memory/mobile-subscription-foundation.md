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
Edge Lock, +500 Steals, Simulator, Model Report — `PremiumFeatureGate` + NavMenu
soft paywall. Not Coach/OTA.

## Admin unlock
Signed-in email matching `EXPO_PUBLIC_ADMIN_EMAILS` (comma-separated) gets full
Pro. Set in `eas.json` production env + OTA publish scripts. Default owner email
is included; add more emails as needed.

## Promo codes / links
Catalog in `lib/entitlements.ts` (`STADIUMVIP` lifetime, `EDGE7` / `EDGE30` /
`FREEMONTH` timed). Redeem on Plans or Account, or open:
`https://<domain>/plans?promo=CODE`

## Hard rules
- **Do not** hard-wall Coach / Discover / guest browse.
- **Do not** add RevenueCat/StoreKit to an OTA (native rebuild + runtimeVersion).
- **Do not** touch `DeferredOtaRuntime` for billing work.

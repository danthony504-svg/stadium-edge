---
name: Mobile soft subscription foundation (OTA-safe)
description: Entitlements + soft paywall without StoreKit/RevenueCat; do not hard-gate Coach or guest browse.
---

# Mobile soft subscription foundation (OTA-safe)

Stadium Edge mobile has a **preview** subscription layer that can ship over OTA
without a native rebuild.

## What exists
- `lib/entitlements.ts` — pure plan/trial/isPro helpers (Node-testable).
- `context/SubscriptionContext.tsx` — AsyncStorage persistence, 7-day local trial,
  `requirePro` soft gate, dismissible `SoftPaywallModal`.
- `app/plans.tsx` — Free / Go ($19.99 wk) / Pro ($49.99 mo) preview picker (mirrors
  web DEMO catalog). Selecting a plan updates local entitlement only — **no charge**.
- Account card + NavMenu **Plans** entry. Guests can open Plans (App Store 5.1.1(v)).

## Hard rules
- **Do not** hard-wall Coach, Discover, Props, Slip, or other browse surfaces on
  `isPro` / auth. Soft prompts only (Account / Plans / optional future CTAs).
- **Do not** add `react-native-purchases` / RevenueCat / StoreKit to an OTA. Real
  IAP needs a **native rebuild** + `runtimeVersion` bump, then wire the same
  entitlement helpers to store receipts.
- **Do not** touch `DeferredOtaRuntime` / expo-updates paths for billing work.
- Guest browsing remains mandatory (`mobile-guest-access-required.md`).

## Default UX
First launch stamps `trialStartedAtMs`; during the trial `isPro === true` so
optional soft gates stay quiet. After expiry on Free, the app still works —
upgrade is optional via Plans / soft sheet.

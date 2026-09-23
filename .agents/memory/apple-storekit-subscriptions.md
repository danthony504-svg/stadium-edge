---
name: Apple StoreKit subscriptions (Settings list)
description: Wire Go/Pro to App Store auto-renewables via RevenueCat so Stadium Edge appears under iOS Settings → Subscriptions; requires native rebuild + runtimeVersion 1.1.0.
---

# Apple StoreKit subscriptions

Paid Go / Pro must go through **Apple StoreKit auto-renewable subscriptions**
to appear under **Settings → [Apple ID] → Subscriptions** (same list as
ChatGPT / Claude / Replit). Custom promo codes never show there.

## Product IDs (App Store Connect)
- Go weekly — `com.stadiumedge.app.go.weekly` — $9.99 / week
- Pro monthly — `com.stadiumedge.app.pro.monthly` — $29.99 / month

## RevenueCat
1. Create a RevenueCat project + iOS app (bundle `com.stadiumedge.app`).
2. Import the two products; map entitlements `go` and `pro`.
3. Put the **public iOS SDK key** in EAS env:
   `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_...`
4. Webhook → `POST https://<api-host>/api/subscriptions/webhooks/revenuecat`
   with `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>` (server env).

## App code
- `lib/storekitProducts.ts` — product / entitlement IDs
- `lib/purchases.ts` — RevenueCat wrapper (no-ops without native + key)
- `context/SubscriptionContext.tsx` — purchase / restore / customer info
- `app/plans.tsx` — Subscribe + Restore + Manage in Apple
- Server: `routes/subscriptions.ts` + `subscription_entitlements` table

## Ship checklist
1. Create products in App Store Connect (auto-renewable).
2. Configure RevenueCat products + entitlements + webhook.
3. Set `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` in **EAS project env / secrets**
   (Expo dashboard → Project → Environment variables, or
   `eas env:create --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --value appl_... --environment production`).
   **Never** put an empty string in `eas.json` — EAS rejects empty env values
   and blocks both `eas build` and `eas channel:edit` / OTA publish.
4. Set `REVENUECAT_WEBHOOK_SECRET` on api-server.
5. `pnpm --filter @workspace/db run push` for new tables.
6. **EAS production iOS build** — `runtimeVersion` is `1.1.0` (native module).
   From `artifacts/stadium-mobile` (with EXPO_TOKEN + non-empty RC key in EAS):
   `EAS_NO_VCS=1 EAS_SKIP_AUTO_FINGERPRINT=1 eas build --platform ios --profile production --auto-submit --non-interactive --no-wait`
7. OTA alone cannot add StoreKit; do not bump runtimeVersion for JS-only OTA.
   Keep `.ota-production-freeze` until TestFlight verifies the native build.

## Soft rules (unchanged)
Discover / Coach / Props / Slip / Weather / Fantasy stay free.
Admin emails + promo codes still unlock without Apple billing.

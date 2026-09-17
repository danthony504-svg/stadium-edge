---
name: Server-backed promo codes
description: /api/promo validate+redeem+entitlement; PROMO_ADMIN_KEY; drizzle promo_codes tables; seed catalog.
---

# Server-backed promo codes

## Endpoints (`api-server` → `/api/promo/*`)
- `POST /promo/validate` `{ code }` — check without redeeming (public, rate-limited)
- `POST /promo/redeem` `{ code, deviceId? }` — Clerk Bearer optional; need **user or deviceId**
- `GET /promo/entitlement?deviceId=` — best active unlock for user/device
- `POST /promo/admin/upsert` — header `x-promo-admin-key: $PROMO_ADMIN_KEY`
- `GET /promo/admin/list` — same admin key; codes + redemption counts

## DB (`lib/db` schema `promoCodes.ts`)
- `promo_codes` — catalog (kind lifetime|days|until, windows, max_redemptions)
- `promo_redemptions` — unique `(code, identity_key)` where identity is `user:<id>` or `device:<uuid>`

After schema change: `pnpm --filter @workspace/db run push` on the deployed DB.

## Seed
First request upserts default opaque codes (`7VXHVPOR`, `KFXD4X2B`, `KK48IZSN`,
`8VZV43WK`, `6EUSDWFI` with Oct flash window + 500 global cap) if the table is empty.

## Mobile
`artifacts/stadium-mobile/lib/promoApi.ts` — `redeemPromoCodeOnServer`,
`fetchServerPromoEntitlement`, stable `getOrCreatePromoDeviceId`. Wire into
`SubscriptionContext` on the subscription foundation branch (prefer server unlock
over local-only catalog when online).

## Env
- `PROMO_ADMIN_KEY` — required for admin upsert/list (not shipped in client)
- `DATABASE_URL` — already required by api-server

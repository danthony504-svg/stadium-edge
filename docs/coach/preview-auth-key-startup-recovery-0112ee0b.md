# Preview auth-key startup recovery — incident RC `0112ee0b`

**Status:** Preview recovery authorized; **production frozen** (no production OTA).  
**Priority:** Pause other releases until preview cold-launch + sign-in pass.

## Affected update

| Field | Value |
|-------|--------|
| Channel | `preview` only |
| Bad update id | `01a14ab5-1271-7d9e-9b76-bdfc53a31197` |
| Bad group | `7d8520cc-0885-42b8-bff0-dad7aad4424d` |
| Baked tip message | `incident RC 0112ee0b33240d82b680e5aa7453b7b53567c554` |
| Launch hash | `Agsx8VqaKnVZI9E2QrI2YjNe7qk8VHkpnPUCM4YfDX4` |
| Runtime | `1.1.0` / iOS |

## Confirmed cause

`app/_layout.tsx` fails closed when `process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is empty:

> App configuration error (missing auth key).

The bad export ran bare:

```bash
export EXPO_PUBLIC_GIT_COMMIT=0112ee0b…
export EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com
# EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY was NOT set
pnpm exec expo export --platform ios --output-dir dist
eas update --channel preview --skip-bundler --input-dir dist …
```

`eas.json` `build.preview.env` is **not** applied by `expo export` / `eas update --skip-bundler`.  
Local HBC `entry-944c0ff4…hbc` contains the “missing auth key” string and **no** `pk_test_cHJvZm91bmQt…` / `profound-raptor` bake. No `sk_*` secrets were present.

## Last working preview (restored)

| Field | Value |
|-------|--------|
| Source tip | `54b89f32efc81fe3cf56cee50388816054484600` |
| Source launch hash | `2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM` |
| Source update (pre-incident) | `01a146ed-1a89-71f5-9e5a-5909a432a38f` |
| Source group | `dd669b36-2dfd-40fb-8970-63ac7b71f759` |
| Recovery republish update | `01a14ac2-0867-7bab-a203-6101a2d7b14c` |
| Recovery republish group | `83b35a33-f008-41b8-a91e-c7fcbf0cd790` |
| Recovery message | `PREVIEW recover 54b89f32/2ecBll — rollback empty-Clerk incident RC 01a14ab5 (prod freeze armed)` |

Manifest associatedDomains include `profound-raptor-92.clerk.accounts.dev` (publishable-key-aligned).

## Corrected incident export

Use `artifacts/stadium-mobile/scripts/export-preview-ota.sh` (sets public Clerk key + forced `EXPO_PUBLIC_GIT_COMMIT`, runs `prepublish-export-auth-check.mjs` before and after export). Then:

```bash
pnpm exec eas update --channel preview --platform ios \
  --skip-bundler --input-dir dist \
  --message "incident RC <tip> — corrected Clerk publishable-key bake"
```

Prepublish check **fails** if the publishable key is missing from env or from the baked HBC, and **fails** if any `sk_*` / `CLERK_SECRET*` is present. Never bake server secrets.

## Device gate (release not passed until)

1. Cold launch on preview IPA / Build 79 — no “missing auth key” screen  
2. `ClerkProvider` mounts (`ClerkLoaded`)  
3. Email/password sign-in succeeds  
4. Attestation: update id = corrected tip; commit hash = forced bake SHA  

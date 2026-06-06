---
name: Biometric sign-in (Face ID login)
description: How Stadium Edge mobile lets users log into their Clerk account with Face ID / Touch ID, and the deliberate security tradeoff.
---

# Biometric sign-in vs the app-lock (two SEPARATE features)

There are now TWO biometric features on mobile — do not conflate them:
- **App-lock** (`context/AppLockContext.tsx` + `components/LockScreen.tsx`, key `se_app_lock_enabled`): gates *opening* the app after you're already signed in.
- **Biometric sign-in** (`lib/biometricLogin.ts`): logs you *into your Clerk account* on the sign-in screen without typing email/password.

## How biometric sign-in works
- After a successful **password** sign-in (not Google SSO — no password to store), `offerBiometricEnroll` asks to save creds. Stored as JSON `{email,password}` in `expo-secure-store` under `se_biometric_login_v1` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the plain email is mirrored to AsyncStorage (`se_biometric_login_email`) so the sign-in screen can decide whether to SHOW the button without a prompt.
- Sign-in screen shows "Sign in with {label}" when `savedEmail && bioSupported`. Tap → `runBiometricGate()` (prompt) → `loadSavedLogin()` → `signIn.password()` → finalize / MFA `sendEmailCode`.
- Account screen has a turn-OFF switch (`clearBiometricLogin`); turning ON from there is impossible (no password in hand while signed in) so it just guides the user to re-sign-in.

**Why split `runBiometricGate` from `loadSavedLogin`:** so the caller can tell a *cancelled prompt* (no-op, no error) from a *missing/corrupt keychain secret* (heal: clear the email mirror + show message). A single combined fn returning null couldn't distinguish them.

## Gotchas / decisions
- **Only forget creds on a genuine wrong-password error** (`isCredentialError` checks Clerk codes form_password_incorrect / form_identifier_not_found / etc). A network/rate-limit error must NOT erase enrollment — just ask to retry.
- **Re-enroll guard is `savedEmail === email`, not `savedEmail`** so a different account can overwrite the saved login.
- **The main sign-in view originally rendered `formError` ONLY in the reset-verify block** — had to add a `formError` render in the main "Welcome back" return or biometric error messages are invisible.
- **Deliberate security tradeoff:** secret is NOT stored with SecureStore `requireAuthentication`. It's app-flow enforced — the *only* reader (`loadSavedLogin`) is always called right after `runBiometricGate` passes. Reason: `requireAuthentication` triggers SecureStore's *own* Face ID prompt, causing a confusing DOUBLE prompt, and can invalidate on biometric-set changes. Matches the existing app-lock trust model.
- **No new native deps:** both `expo-secure-store` (Clerk token cache already uses it) and `expo-local-authentication` were already installed; `expo-local-authentication` plugin already supplies the Face ID permission string. So this ships in any full build (no extra native work) — but it's NOT pure-OTA-safe on a binary that predates those modules.

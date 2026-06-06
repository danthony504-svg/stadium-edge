---
name: Mobile biometric app-lock (Face ID / Touch ID)
description: How the optional biometric app-lock is built and the two non-obvious correctness traps it must avoid.
---

# Biometric app-lock (Stadium Edge mobile)

Optional Face ID / Touch ID gate layered ON TOP of Clerk auth (a privacy lock, not
account auth). Setting persisted in AsyncStorage; provider wraps the app inside
ClerkProvider; a full-screen overlay gates everything when locked. Toggle lives on
the Account screen. Uses `expo-local-authentication` (works in Expo Go) + the
`expo-local-authentication` config plugin in app.json for the iOS `NSFaceIDUsageDescription`.

## Trap 1 — cold-start race must FAIL CLOSED
The provider learns `enabled`/hardware-support asynchronously (AsyncStorage +
`hasHardwareAsync`/`isEnrolledAsync`). If the gate renders nothing until that
resolves, protected content FLASHES before the lock engages on cold start.
**Fix:** the gate renders an opaque navy cover (matches splash bg) whenever
`!ready`, regardless of `enabled`. Only after `ready` does it decide lock vs. pass.

**Why:** "lock on launch" is a security claim; a visible flash breaks it.

## Trap 2 — AppState re-lock loop
The native biometric prompt pushes the app to `inactive`, NOT `background`. If you
re-lock on `inactive` you immediately re-prompt → infinite loop. Also the app-switcher
peek reports `inactive`.
**Fix:** only re-lock on a genuine `background` transition, AND guard with an
`authenticatingRef` so a prompt in flight can't trigger a lock.

## Other invariants
- Web / no-biometric devices: `supported = hasHardware && isEnrolled` → when false
  the lock NEVER engages (no dead-end). `authenticate()` early-returns success when
  unsupported. `effectiveEnabled = savedEnabled && supported`.
- Enabling the lock first runs a biometric verify (don't trust a toggle you can't satisfy);
  disabling is free while already unlocked.
- New native module → RESTART the Expo (Metro) workflow or it won't resolve.

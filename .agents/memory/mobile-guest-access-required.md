---
name: Mobile guest access is mandatory (App Store 5.1.1(v))
description: Why stadium-mobile must open without login, and which surfaces may gate on auth.
---

# Mobile guest access is mandatory (App Store 5.1.1(v))

The stadium-mobile app must be **freely browsable without an account**. Do NOT
add a forced sign-in/registration wall in front of the main tabs.

**Why:** Apple rejected the app under Guideline 5.1.1(v) — "the app requires
users to register or log in to access features that are not account based." A
hard auth gate in `app/(tabs)/_layout.tsx` was redirecting signed-out users to
`/welcome` before they could see games/odds/props. Apps may only require
registration for genuinely account-based features.

**How to apply:**
- The app opens directly to the home tab for everyone. `(tabs)/_layout.tsx` has
  NO auth redirect.
- Sign-in is OPTIONAL and only unlocks account-based features: cloud sync of
  saved slips / pick tracker (`context/BetSlipContext.tsx`, gated on
  `isSignedIn && userId`), push notifications, and the Account screen. Those
  screens gate themselves (`app/account.tsx`, `app/notifications.tsx` redirect to
  `/sign-in`); `NavMenu` shows "Sign in" for guests.
- Guests get the full browsing + AI Coach + local bet slip experience. Sync code
  is already safe for signed-out (keeps local state, fires no authed calls);
  api-server has optional auth (limiters key on userId else IP).
- The `/welcome` screen still exists but is no longer a forced landing — it's
  reachable only via the auth flow.

**Companion App Store note (Guideline 2.1):** reviewers also asked how users
"use and pay for the bet slips." Stadium Edge is an **analysis / parlay-builder**,
NOT a sportsbook — it never takes real-money wagers or payments for bets. The
slip is a free planning/tracking tool. Answer 2.1 in App Store Connect (no code
change): explain there is no in-app purchase or payment for placing bets.

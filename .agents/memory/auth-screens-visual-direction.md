---
name: Mobile auth screens visual direction + entry flow
description: Why stadium-mobile auth screens use blue (not the app cyan) and how the signed-out entry routing is wired.
---

# Mobile auth screens — blue accent, welcome entry point

**Rule:** The stadium-mobile auth screens (welcome / sign-in / sign-up) intentionally
use a BLUE accent (`AUTH_ACCENT = "#3b82f6"` exported from `components/auth.tsx`) plus a
blue gradient on primary buttons, diverging from the app's CYAN brand (`colors.primary`
`#22d3ee`) used everywhere else.

**Why:** The user supplied explicit "Welcome back" and "Bet Smarter. Win More." mockups
that are blue. Do NOT "fix" these screens back to cyan for brand consistency — the blue is
deliberate and mockup-driven.

**How to apply:**
- Reuse `AUTH_ACCENT` and the shared `GoogleAuthButton` / `AuthShell` / `AuthField` /
  `PrimaryButton` from `components/auth.tsx` for any new auth surface.
- Signed-out entry point is `/welcome` (the `(tabs)` hard gate redirects there, not to
  `/sign-in`). Welcome branches: Create Free Account → `/sign-up`, Sign in → `/sign-in`.
  `(auth)/_layout` still bounces signed-in users to `/account`.

**Decorative imagery vs. never-fabricate:** The HARD never-fabricate rule is DATA-only
(odds/stats/picks). Decorative hero art is fine to AI-generate — `welcome-hero.png` (the
football-player hero) is generated art, not a real photo/data, and that's acceptable.

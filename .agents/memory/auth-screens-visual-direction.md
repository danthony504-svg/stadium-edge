---
name: Mobile visual direction (blue brand) + auth entry flow
description: stadium-mobile uses a single BLUE brand accent (#3b82f6) app-wide; how the signed-out entry routing is wired.
---

# Mobile brand — single blue accent, welcome entry point

**Rule:** The ENTIRE stadium-mobile app uses ONE blue accent `#3b82f6` (blue-500).
This is the `colors.primary`, `colors.tint`, AND `colors.accent` value in
`constants/colors.ts`, and it equals `AUTH_ACCENT = "#3b82f6"` exported from
`components/auth.tsx`. The app was originally CYAN (`#22d3ee` / accent `#06b6d4`);
the user later asked for everything blue, so cyan is fully retired on mobile.

**Why:** User mockups for auth ("Welcome back" / "Bet Smarter. Win More.") were blue,
then the user said "all the blue buttons and glow should be #3b82f6" pointing at the
cyan home screen. So the whole mobile app was recolored cyan→blue. Do NOT revert any
mobile surface to cyan for "brand consistency" — blue is the brand now.

**How to apply:**
- All cyan lived ONLY in `constants/colors.ts` tokens plus a handful of faint
  `rgba(34,211,238,...)` tint fills (active/added chip backgrounds) and one
  `rgba(6,182,212,...)` accent badge bg. Those rgba fills are now
  `rgba(59,130,246,...)` (= #3b82f6). If adding a new faint-accent fill, use
  `rgba(59,130,246,alpha)`, never cyan.
- Glows/shadows in the app are black (`shadowColor: "#000"`), NOT colored — the
  perceived "glow" is just the bright accent color itself.
- Reuse `AUTH_ACCENT` and the shared `GoogleAuthButton` / `AuthShell` / `AuthField` /
  `PrimaryButton` from `components/auth.tsx` for any new auth surface.
- Signed-out entry point is `/welcome` (the `(tabs)` hard gate redirects there, not to
  `/sign-in`). Welcome branches: Create Free Account → `/sign-up`, Sign in → `/sign-in`.
  `(auth)/_layout` still bounces signed-in users to `/account`.
- NOTE: the sibling WEB artifact (artifacts/stadium-edge) was NOT recolored — it still
  uses cyan. Only touch web if the user explicitly asks.

**Decorative imagery vs. never-fabricate:** The HARD never-fabricate rule is DATA-only
(odds/stats/picks). Decorative hero art is fine to AI-generate — `welcome-hero.png` (the
football-player hero) is generated art, not a real photo/data, and that's acceptable.

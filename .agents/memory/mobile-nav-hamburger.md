---
name: Mobile nav — top hamburger instead of bottom tabs
description: stadium-mobile dropped the bottom tab bar for a top-right hamburger menu; how the navigation is wired now.
---

# Mobile navigation: top hamburger, no bottom bar

stadium-mobile originally used a bottom tab bar in `app/(tabs)/_layout.tsx`
(expo-router `Tabs`, plus a `NativeTabs` liquid-glass path for iOS 26). The user
asked to remove the bottom bar and use a "3-line tab at the top".

**How it works now:**
- `app/(tabs)/_layout.tsx` is a plain `Stack` (headerShown false) wrapped in a
  `<View flex:1>`, with a single `<NavMenu/>` rendered as a sibling AFTER the
  Stack so it floats over ALL four tab screens. No new nav dependency was added
  (`@react-navigation/drawer` is NOT installed — a drawer was avoided).
- `components/NavMenu.tsx` = a self-contained floating hamburger button
  (absolute TOP-LEFT, `insets.top + 6`, `left:16`) + a transparent `Modal`
  dropdown (also `left:16`) listing Home `/`, Coach `/coach`, Props `/props`,
  Slip `/slip`. Active route via `usePathname()` (`/` matches "" and "/index");
  navigate via `router.navigate`. Slip leg count shows as a badge.
- Rendering NavMenu once in the layout (not per-screen) keeps the four screens'
  own title headers intact — no double header, no per-screen edits.
- **Left-placement collision gotcha:** because the hamburger floats at top-left,
  screens whose title sits at the very top-left collide with it. props/coach
  headers get `paddingLeft:64` and slip's title row `paddingLeft:48` (its
  container already adds 16) to clear the button → reads as `[≡] Title` app-bar.
  Home is exempt (logo is centered; top-left is empty). If the menu is ever
  moved back to the right, revert these indents.

**Gotcha:** the scroll screens (index/props/slip) had
`paddingBottom: insets.bottom + 96` reserving space for the floating tab bar.
With the bar gone that left a dead gap — reduced to `insets.bottom + 24`. Coach
keeps its own composer bottom inset. The hamburger overlaps the top-right corner
of each screen, which is empty on all four (titles are left/centered), so no
layout conflict.

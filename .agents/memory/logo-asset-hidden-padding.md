---
name: Logo asset hidden padding
description: stadium-mobile logo.png has huge baked-in transparent bands; a trimmed wordmark exists for flush headers
---

# Logo asset hidden transparent padding

`artifacts/stadium-mobile/assets/images/logo.png` is a 1983×793 canvas, but the
visible "SE STADIUM EDGE" mark is only ~1564×250 (content aspect ~6.26). It carries
roughly **34% transparent bands on the top AND bottom**, plus ~10% side margins.

**Why it matters:** rendering it at a tall box (e.g. `width:"100%", height:130`,
`resizeMode:"contain"`) shrinks the *visible* mark to a small strip (~41px tall)
floating centered in the box — looks like a tiny logo in a big empty gap. This is
what caused the Player Props header "logo + search bar at top look off" report.

**A trimmed `logo-wordmark.png` (1584×270) exists** and was briefly used in the Home +
Player Props headers, BUT the user reverted it.

**USER PREFERENCE (authoritative): keep the FULL original `logo.png` at its original
size on every header — Home (`app/(tabs)/index.tsx`) AND Player Props
(`app/(tabs)/props.tsx`) — at `width:"100%", height:130, marginTop:-8`.** The user
WANTS the larger full-width logo and is fine with the surrounding whitespace; they
explicitly asked to change it "back to original size." Do NOT swap back to
`logo-wordmark.png` to "fix the gap" — that is not a bug to them.
Also: `fadeDuration={0}` on those `<Image>`s so the logo paints instantly (no
Android fade / "loaded in" flash); the header is already pinned via
`stickyHeaderIndices={[0]}`.

**How to apply:** use `logo.png` at `width:"100%", height:130` for the mobile
Home/Props headers. `logo-wordmark.png` is now unused by tabs (kept as an asset only).
`(auth)/welcome.tsx` and `components/auth.tsx` also use `logo.png` at their own fixed
sizes.

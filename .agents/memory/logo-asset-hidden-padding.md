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

**Fix in place:** `assets/images/logo-wordmark.png` (1584×270, aspect ~5.87) is the
tightly-cropped version. Both the Player Props header (`app/(tabs)/props.tsx`) AND the
Home header (`app/(tabs)/index.tsx`) use it at
`width:Math.min(250, screenWidth-32), aspectRatio:1584/270, paddingTop:insets.top+6`
for a flush, compact header that pins logo + search bar to the top (no big empty gap).

**How to apply:** for any FLUSH/compact header, use `logo-wordmark.png`, not
`logo.png`. The original padded `logo.png` is still used intentionally by
`(auth)/welcome.tsx` and `components/auth.tsx` at their own fixed sizes — do NOT swap
those without re-tuning each box, since trimming changes the effective render size. If
a global trim is ever wanted, overwrite `logo.png` and re-size those call sites
together.

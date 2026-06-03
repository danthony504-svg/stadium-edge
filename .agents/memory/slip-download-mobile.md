---
name: Mobile bet-slip "Save to Photos"
description: How the Expo app saves a bet-slip image to Photos, and the never-fabricate constraints on the server renderer.
---

# Mobile bet-slip download (Save to Photos)

The Stadium Edge Expo app runs in **Expo Go only**, so `react-native-view-shot`
is unavailable — you cannot rasterize a React view to an image there. The slip
PNG is therefore rendered **server-side** and the device just saves the bytes.

## Flow
- api-server `POST /api/slip-image` (routes/slipImage.ts) takes `{legs:[{pick,market,game,odds}], stake}`, computes parlay math itself, and renders a dark PNG with `@napi-rs/canvas`, returning `{png: <base64>}`.
- mobile `lib/slipImage.ts` POSTs the real legs+stake, writes the base64 to `cacheDirectory`, and saves via `expo-media-library` `saveToLibraryAsync` after `requestPermissionsAsync`.
- Buttons live in `app/(tabs)/slip.tsx` (full slip) and `components/SlipBar.tsx` (floating overlay).

## Gotchas (non-obvious, cost time)
- **esbuild can't bundle `@napi-rs/canvas`**: the api-server `build.mjs` already externalizes `*.node`, but that does NOT stop esbuild from trying to bundle the package's `js-binding.js` which `require`s the platform binary. You must externalize the package name itself (`@napi-rs/canvas` + `@napi-rs/*`) or the whole API build fails with "No loader is configured for .node files".
- **expo-file-system v19 default API is the new file-handle one** — import from `expo-file-system/legacy` to keep `writeAsStringAsync(uri, base64, {encoding: EncodingType.Base64})`.
- **Config plugin vs runtime**: add `expo-media-library` to `app.json` plugins for correctness, but in Expo Go the lib is already bundled; the plugin only matters for prebuild/native builds.
- **Web safety**: these screens also render on web (preview), where media-library/file-system are shims. Keep the whole save flow in a try/catch and return a tagged result so a shim failure shows an alert, never a crash.

## Never-fabricate applies to the SERVER renderer too
The HARD never-fabricate rule extends to defaults inside `slipImage.ts`:
- **Do NOT default a missing/invalid stake to a made-up number** (an earlier version used `stake>0 ? stake : 10`). A real `$0` slip must render `$0 / To win $0.00`. Use the sent stake as-is for any finite `>=0`; only non-numeric/NaN falls back to 0.
- **Mirror the client parlay math**: treat `odds === 0` as "no price" (null), not a real leg — it both breaks the decimal conversion (`100 / -0`) and would invent a number. A null-odds leg renders `—` and is excluded from the combined.
**Why:** the image is a shareable artifact; any number on it that wasn't a real book price / real user stake is fabrication.

## Floating-overlay maxHeight rule
`SlipBar` expanded list had a fixed `maxHeight: 260`. When the bar floats high
(Coach + keyboard, `barBottom = kbHeight + clearance`), a fixed/large cap makes
the card taller than the space left above it, pushing the top — and the **last
pick** — off-screen with no way to scroll to it.
**Fix/rule:** size the list cap from genuinely-available space
(`screenH - barBottom - insets.top - chromeReserve`) and **never force a minimum
taller than what's actually available** — only apply a comfortable min when there
is room, else let the list shrink and rely on scroll. A floor larger than
available is exactly what clips the bottom row.

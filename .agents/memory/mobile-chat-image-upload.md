---
name: Mobile AI Coach photo upload (vision)
description: How the Expo coach chat sends a user photo (bet slip/screenshot) to the vision model, and the non-obvious gotchas.
---

# Mobile AI Coach photo upload → vision

The Expo coach chat (`artifacts/stadium-mobile/app/(tabs)/coach.tsx`) lets a user
attach a photo (bet slip / sportsbook screen / scoreboard). It is compressed to a
small JPEG base64 **data URL** and sent to the vision-capable chat model, which
reads it and advises. Web client does NOT have this (mobile-only by request).

## Wiring (the contract, not the diff)
- Transport key is `imageDataUrl` (optional, base64 data URL) added to the chat
  request schema in `lib/api-spec/openapi.yaml` → codegen → mobile `streamChat`
  POST body → server `chat.ts`.
- Server attaches the image to the **LATEST user message only**, as a multimodal
  content array `[{type:text},{type:image_url}]`. Every other turn stays a plain
  string. Wrong placement (system msg, or all user turns) is the classic vision bug.

## Non-obvious gotchas
- **Metro must be restarted after installing a new native module.** After adding
  `expo-image-manipulator`, the web bundle 500'd with `Unable to resolve module …`
  even though `node_modules` had it — the dev server cached its resolver from
  before the install. Restart the expo workflow; typecheck passing does NOT catch this.
- **`launchImageLibraryAsync` needs no runtime permission** on modern iOS/Android
  (system photo picker). Don't add a permission request / `Linking.openSettings`
  dance for library picks. (Expo Go warns it can't give full media access — picker still works.)
- **Bypass the text-only stat-card lookup when an image is attached** — `tryStatCard`
  can't read an image, so go straight to the vision AI path.
- **Validate the data URL server-side before forwarding** to the model's `image_url`:
  require `^data:image/(jpeg|jpg|png|webp);base64,` and a length cap (~7MB base64 ≈
  ~5MB raw, matching the body limit). Drops remote/junk URLs so we never forward an
  untrusted arbitrary URL into model input.

## Never-fabricate boundary
- Enforcement for image-read numbers is **prompt-only** (IMAGE-ANALYSIS addendum:
  list what's legible, say "cut off/blurry" instead of guessing). There is no
  deterministic source to post-validate against the way pick-parsing has real-odds
  filters — vision IS the read. An OCR-extract-then-constrain layer was considered
  and **deliberately left out of scope** (user asked for vision analysis).
- **Why:** future "AI made up a number from a slip" reports are a prompt-tuning
  problem here, not a missing post-filter — don't go hunting for a validator that
  was never built.

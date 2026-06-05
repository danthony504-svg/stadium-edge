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
- Two transport keys: `imageDataUrls` (preferred, `string[]`, **max 3**) and the
  legacy `imageDataUrl` (single). Both live in the chat request schema in
  `lib/api-spec/openapi.yaml` → codegen (`pnpm --filter @workspace/api-spec run codegen`)
  → mobile `streamChat` POST body → server `chat.ts`. Keep both for back-compat.
- Server merges `imageDataUrls` + legacy single, validates each, **dedupes exact
  dupes**, hard-caps at `MAX_IMAGES=3`, attaches ALL as multiple `image_url` blocks
  to the **LATEST user message only**: `[{type:text}, ...{type:image_url}]`. Every
  other turn stays a plain string. Wrong placement (system msg, or all user turns)
  is the classic vision bug. Addendum wording pluralizes on count.
- **api-zod object strips unknown keys** (not `.strict()` but default zod strips):
  a new body field MUST be added to the OpenAPI spec + regenerated, or
  `parsed.data.<field>` is silently `undefined`.
- Express body limit is **5mb total** (`express.json({limit})`) — fine because the
  mobile picker downscales (≤1280px, q0.6 JPEG) so 3 images stay well under it.

## Mobile UI (multi-image)
- `attachedImages` is an **array** (`{uri,dataUrl}[]`); picker uses
  `allowsMultipleSelection:true` + `selectionLimit: remaining` and appends, slicing
  to 3. Preview is a wrap row with per-image remove. Picker button disabled at 3.
  `UIMessage.imageUris?: string[]` renders all thumbnails in the sent bubble.

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

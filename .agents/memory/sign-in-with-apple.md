---
name: Sign in with Apple (mobile)
description: How Apple SSO is wired on the Expo auth screens and the non-obvious runtime config it depends on.
---

Mobile "Sign in with Apple" was added to satisfy App Store Guideline 4.8 (app offers
third-party/Google login via Clerk, so it must offer an equivalent Apple option).

Implementation = WEB OAuth via Clerk Expo `useSSO().startSSOFlow({ strategy: "oauth_apple" })`,
mirroring the existing Google button (`AppleAuthButton` next to `GoogleAuthButton`).

**Why web OAuth, not native `expo-apple-authentication`:** web OAuth is JS-only — it needs
NO native entitlement (`usesAppleSignIn`), NO new package, and NO native rebuild, and it
matches how Google already works in this app. Native Apple sign-in would force an entitlement +
Clerk native credential config + a fresh EAS build for no compliance gain.

**Non-obvious runtime dependency (config, not code):** the button only FUNCTIONS once Apple is
enabled as a login provider in the Replit-managed Clerk **Auth pane** (workspace toolbar). Agent
cannot enable it programmatically — the user must toggle it. Until then the button renders but
the flow errors on press.

**How to apply:**
- 4.8 equivalence = Apple must appear EVERYWHERE Google does. Currently rendered on
  `welcome.tsx`, `sign-in.tsx`, AND `sign-up.tsx`. If a new social-login surface is added, add Apple too.
- Button styling follows Apple guidelines: white button + black Apple glyph + "Continue with Apple"
  (white is the Apple-approved style for dark backgrounds; the auth UI is dark navy).
- Keep it in lockstep with `GoogleAuthButton` (same SSO/session/navigate logic).

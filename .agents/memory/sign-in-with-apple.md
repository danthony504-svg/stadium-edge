---
name: Sign in with Apple (mobile)
description: How Apple SSO is wired on the Expo auth screens and the non-obvious runtime config it depends on.
---

Mobile "Sign in with Apple" was added to satisfy App Store Guideline 4.8 (app offers
third-party/social login via Clerk, so it must offer an equivalent Apple option).

**UPDATE — Google sign-in REMOVED (mobile):** per user request the `GoogleAuthButton`
(and `GoogleG` glyph) were deleted from `components/auth.tsx` and pulled from welcome/
sign-in/sign-up. Apple + email/password remain. Apple still satisfies 4.8 because it is
itself a third-party login. Do NOT re-add Google as a "parity" requirement — there is no
Google button to mirror anymore. Web (stadium-edge) Google is a separate concern: it's a
Clerk Auth-pane provider toggle on the hosted `<SignIn>/<SignUp>`, not code — disable it
there to remove it from web.

Implementation = WEB OAuth via Clerk Expo `useSSO().startSSOFlow({ strategy: "oauth_apple" })`.

**Why web OAuth, not native `expo-apple-authentication`:** web OAuth is JS-only — it needs
NO native entitlement (`usesAppleSignIn`), NO new package, and NO native rebuild, and it
matches how Google already works in this app. Native Apple sign-in would force an entitlement +
Clerk native credential config + a fresh EAS build for no compliance gain.

**Non-obvious runtime dependency (config, not code):** the button only FUNCTIONS once Apple is
enabled as a login provider in the Replit-managed Clerk **Auth pane** (workspace toolbar). Agent
cannot enable it programmatically — the user must toggle it. Until then the button renders but
the flow errors on press.

**How to apply:**
- Apple is currently rendered on `welcome.tsx`, `sign-in.tsx`, AND `sign-up.tsx`. If any new
  third-party/social-login surface is added, add Apple alongside it to keep 4.8 compliance.
- Button styling follows Apple guidelines: white button + black Apple glyph + "Continue with Apple"
  (white is the Apple-approved style for dark backgrounds; the auth UI is dark navy).

**CRITICAL — which Clerk instance the SHIPPED app uses:** `eas.json` bakes a `pk_test_…`
publishable key into BOTH the `preview` AND `production` build profiles, so TestFlight/App-Store
builds talk to the Clerk **development** instance, not production. Consequences:
- Apple sign-in in the shipped app works iff Apple is **enabled on the DEV instance** (dev uses
  Replit-managed/shared Apple credentials — no Apple Developer account needed; consent screen shows
  Replit branding). The PRODUCTION Apple credentials (Services ID/Key/Team ID in the Auth pane
  prod setup) are **NOT used** by the mobile app while it ships on `pk_test`.
- Because preview also uses the dev instance, an Apple failure reproduces in the Expo preview — no
  rebuild needed to diagnose.
- Do NOT blindly switch eas.json to `pk_live`: the api-server verifies Clerk tokens with a secret
  key bound to ONE instance; flipping the app's publishable key without matching the server's secret
  key instance breaks ALL authenticated API calls. It's a coordinated change.
- The Apple button's `catch` must stay non-throwing (a thrown `JSON.stringify` on a circular error
  re-creates the "unresponsive button" App-Review rejection); it surfaces Clerk's real error via
  `describeSsoError` so the exact cause (e.g. provider-not-enabled) is visible.

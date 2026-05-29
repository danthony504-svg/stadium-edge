---
name: Stadium Edge auth (real Clerk replacing mock)
description: How real Replit-managed Clerk auth was wired into Stadium Edge, replacing a mocked login, and the duplicate-ParlayBuilder gotcha.
---

# Stadium Edge authentication

Stadium Edge originally shipped a **mocked** login: a `loggedIn` boolean gate
(default `true`, bypassed) with fake email/SMS verification codes inside
`ParlayBuilder.tsx`. This was replaced with **real Replit-managed Clerk** auth.

## Key decisions
- The app stays a **public landing** — `/` renders `ParlayBuilder` for everyone,
  signed in or not. Auth is OPTIONAL (sign in to attach tracked slips to an
  account). Never force unauthenticated users to a sign-in screen.
  **Why:** Clerk skill hard rule + this is a single-surface demo, not a
  landing-vs-portal app, so no portal redirect.
- Routing lives in `App.tsx` (wouter `<WouterRouter base>` + `<ClerkProvider>`),
  routes `"/"`, `"/sign-in/*?"`, `"/sign-up/*?"`. `ParlayBuilder` is rendered
  *inside* `ClerkProvider`, so it can call `useUser`/`useClerk` directly.
- Sign-in/up pages branded to the dark-slate + cyan theme via `dark` theme from
  `@clerk/themes` + `variables` (colorPrimary `#22d3ee`) + `public/logo.svg`.
  Font Bricolage Grotesque is loaded globally in `index.css` (the site font),
  not just inside ParlayBuilder's inline `<style>`, so the Clerk pages match.
- Tailwind v4 here: `@layer theme, base, clerk, components, utilities;` must come
  **before** `@import "tailwindcss"` in `index.css`, `cssLayerName: "clerk"` in
  appearance, and `tailwindcss({ optimize: false })` in `vite.config.ts`.

## DUPLICATE ParlayBuilder gotcha
There are TWO `ParlayBuilder.tsx`:
1. `artifacts/stadium-edge/src/ParlayBuilder.tsx` — the LIVE app (~11k lines).
2. `artifacts/mockup-sandbox/src/components/mockups/ParlayBuilder.tsx` — a
   standalone Canvas design-preview copy. It is NOT imported by the live app and
   intentionally keeps its own self-contained code (still has the old fake-auth
   identifiers).
**Why it matters:** a repo-wide grep for `loggedIn`/`loginEmail` will hit the
mockup copy. That is expected — do NOT "fix" the mockup copy when changing the
real app; they are separate artifacts.

## Server
`api-server/src/app.ts`: proxy middleware mounted at `CLERK_PROXY_PATH` BEFORE
body parsers, then `cors({ credentials: true, origin: true })` (skill-prescribed
canonical line — keep verbatim), then `clerkMiddleware(...)` (host-resolved key),
all ungated by NODE_ENV. api-server is one-shot build+start → restart workflow
after edits.

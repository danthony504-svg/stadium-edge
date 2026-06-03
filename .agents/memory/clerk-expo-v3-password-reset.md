---
name: Clerk @clerk/expo v3 password-reset (Future API)
description: How to build a custom forgot-password flow with the Clerk Expo v3 Future hooks API.
---

The clerk-auth skill reference documents sign-in/sign-up but NOT password reset,
and the @clerk/shared type .d.ts is display-redacted (tokens like "email" show as
"ln"), so the API is hard to discover by grep. The real sequence (off `signIn`
from `useSignIn()`):

1. `signIn.create({ identifier: email })` — sets the account / starts a fresh attempt.
2. `signIn.resetPasswordEmailCode.sendCode()` — no params; emails the first email on file.
3. `signIn.resetPasswordEmailCode.verifyCode({ code })` — status → `'needs_new_password'`.
4. `signIn.resetPasswordEmailCode.submitPassword({ password })` — status → `'complete'`.
5. `signIn.finalize({ navigate })` — activates the session.

Each method returns `{ error: ClerkError | null }` (await + early-return on error).
There is a parallel `resetPasswordPhoneCode.*` namespace with the same shape.

**Why:** Future API differs from legacy Clerk (`signIn.create({ strategy: 'reset_password_email_code' })`);
don't rely on generic Clerk docs.

**How to apply:** When abandoning the flow, call `await signIn.reset()` before
returning to the normal password/MFA path or the stale attempt derails it. After
`submitPassword`, guard for status !== 'complete' and surface a fallback message.

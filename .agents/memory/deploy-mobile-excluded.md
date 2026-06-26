---
name: Mobile excluded from production deploy
description: Why stadium-mobile is dev-only in the autoscale deploy, and how that connects to image-upload chat failures in production
---

# stadium-mobile is intentionally DEV-ONLY in the autoscale deploy

`artifacts/stadium-mobile/.replit-artifact/artifact.toml` has **no `[services.production]`
block** (keeps only `[services.development]` + `[services.env]`). This mirrors the
`mockup-sandbox` artifact, which also has no production service and deploys fine — so an
artifact with no production config is simply skipped at publish, it does not error the build.

**Why:** the production deploy builds every artifact's `[services.production].build`. The
Expo static bundle step (`scripts/build.js`, Metro bundling iOS **and** Android) was the slow
single point of failure — it timed out the whole autoscale publish (a download-timeout at the
old 5-min cap, bundle at 99.9%). api-server and stadium-edge build in seconds; the mobile
bundle was the only fragile link. Even with the timeout raised to 12m it stayed risky and
blocked every publish. The real iOS app ships through the App Store via **EAS** builds and
talks to the **deployed api-server** directly — it never needed a production web service at
`/mobile/`. Removing it makes publishing fast and bulletproof.

**Tradeoff:** the only thing lost is the `/mobile/` **web preview** on the published domain
(returns 404 in prod now). iOS app + backend are untouched.

**How to apply:** do NOT re-add `[services.production]` to stadium-mobile to "fix the
/mobile/ 404 in prod" — that reintroduces the publish-timeout SPOF. If a production web
preview of the mobile app is ever genuinely needed, solve the Metro-bundle slowness first.
To edit artifact.toml you MUST write a sibling `*.edit.toml` and call
`verifyAndReplaceArtifactToml({tempFilePath, artifactTomlPath})` (absolute paths) — direct
edits are blocked.

# "AI service is temporarily unavailable" on IMAGE uploads only = stale prod deploy

When the published mobile app shows "AI service is temporarily unavailable" specifically on a
**photo/vision** Coach request while **text** chats still work, the cause is a **stale
production api-server**, not a code bug:

- Vision/image calls are much heavier on the upstream AI proxy → far more likely to hit a
  transient 429/5xx/timeout on the initial create.
- The chat connect-retry (3 attempts, backoff+jitter, transient-only) that absorbs those
  blips landed AFTER the live build. Without it, one blip surfaces as "AI service is
  temporarily unavailable". Light text calls usually succeed first try, which is why they
  still work in prod and mask the staleness.
- The mobile client already compresses uploads (resize 1280px, JPEG q0.6) so this is NOT a
  payload-size / 5MB-body-cap issue.

**Why prod was stale:** publishing kept failing on the mobile-bundle timeout (above), so the
deployed build was many days old and missing a week of chat fixes. The two problems are the
same problem — fixing the publish (exclude mobile) lets a fresh deploy ship the chat fixes.

**How to apply:** if image chat fails in prod but works in dev, check `git log` dates of
chat resilience commits vs the live build time, then redeploy — don't hunt for a phantom
live bug. Dev source fixed ≠ prod fixed.

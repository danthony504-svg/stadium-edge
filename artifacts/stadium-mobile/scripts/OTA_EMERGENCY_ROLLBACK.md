# Emergency production OTA rollback (audited)

## Allowed emergency path (no new JS)

Use **Rollback production OTA (embedded)** only:

- Workflow: `.github/workflows/rollback-production-ota.yml`
- Script: `scripts/rollback-production-ota.sh`
- Action: `eas update:roll-back-to-embedded` for `app.json` `runtimeVersion` (currently **1.1.0**)
- Does **not** bundle or publish new JavaScript from HEAD

This is the documented recovery when a bad OTA must be cleared quickly.

## Publishing new production JS (gated)

These workflows publish **new** production-channel bundles and MUST:

1. Run `scripts/run-reliability-critical-tests.sh`
2. Require explicit confirmation input `PUBLISH_NEW_OTA` (alternative paths) or use the normal/force publish workflows

| Workflow | New JS? | Gate |
|----------|---------|------|
| `publish-production-ota.yml` | Yes | Critical tests |
| `force-production-ota.yml` | Yes | Critical tests |
| `bootstrap-ota.yml` | Yes | Critical tests + `confirm_publish=PUBLISH_NEW_OTA`; no push trigger |
| `heal-production-ota.yml` | Yes (after embedded rollback) | Critical tests + `confirm_publish=PUBLISH_NEW_OTA`; no push trigger |
| `ota-test-001.yml` / `ota-test-002.yml` | Yes | Critical tests + `confirm_publish=PUBLISH_NEW_OTA`; no push trigger |
| `republish-stable-production-ota.yml` | Republish existing group | Critical tests + `confirm_publish=REPUBLISH_STABLE` |
| `rollback-production-ota.yml` | No | Embedded rollback only |

## Bypass prevention (repo + GitHub settings)

- Alternative publish workflows no longer auto-run on `push` path triggers.
- Jobs no-op unless the confirm input matches exactly.
- Critical tests are asserted by `artifacts/api-server/test/reliabilityOtaWorkflowGates.test.ts`.
- **Ops:** keep `main` branch protection requiring PR reviews; restrict who can run `workflow_dispatch` with `EXPO_TOKEN`. This PR cannot change GitHub org permissions — verify in repo Settings → Actions / Branches.

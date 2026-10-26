# Post-merge deploy verification (#932)

**Merged:** `58f320fe` (PR #932, 2026-10-26 ~12:54 PM America/Chicago)  
**Live at write time:** still `deploymentSha=a0e7dc39…` — Deploy API server failed again (`RENDER_DEPLOY_HOOK` empty). Cloud agent cannot `workflow_dispatch` (403).

## Operator steps

1. Redeploy `stadium-edge.onrender.com` to **`58f320fe7c7ce8d956061cf1c0ed071ba639ce37`** (or later main).
2. Confirm `/api/healthz` shows that SHA.
3. Confirm `/api/research/ncaaf/status` includes:
   - `collectionEvidence` (pipeline/usage blockers)
   - `coachEnablementDecision.decision = "BLOCKED"`
4. After a completed odds slot, confirm lifecycle/collection still runs free refresh and `research:ncaab` is unrelated; usage latest should be either `waiting_for_verified_availability_bindings` or processed saves — **not** a hard collector failure solely from empty bindings.
5. Holdout confirmation (evidence, not a waiver):
   - `verifiedAvailabilityBindings > 0`
   - `futureHoldoutContexts > 0`
   - `independentHoldoutForecasts` increasing only for prospective post-freeze games

As of merge time: bindings **0**, future contexts **0**, independent holdouts **0**.

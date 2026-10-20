# Stadium Edge open work — October 20, 2026

Updated by the stabilization batch; see [implementation and release evidence](stadium-edge-stabilization-2026-10-20.md). This separates proven remaining work from older requests lacking end-to-end closure. A merged PR, enabled toggle, or approved subscription is not proof of live delivery.

| Work | Verified state / remaining step |
|---|---|
| Prop error audit | PR #861 merged: request-level reports and source-to-display delivery checks implemented. Needs preview OTA and iPhone validation. |
| Coach speed / empty free two-leg requests | Optional context now has a bounded budget; a live sample returned 2/2 in 35.2s. The 15–30s target and device coverage remain open; this is not a controlled benchmark. |
| Free two-leg early completion and cancellation reporting | PR #859 merged. API portion is deployed as part of current main. Latest production mobile OTA / device verification is not confirmed here. |
| Automatic API deployment | Missing hook now fails visibly instead of claiming success. Hook configuration and deployment-SHA verification remain external. |
| Referral rewards | Implementation exists, but activation requires migration, durable key, Apple week/month offer inventory, enable flag, mobile rollout and real-account redemption testing. No verified live closure in this thread. |
| Daily phone updates | Registration failure handling and per-device acceptance/retry logic fixed; freshness gate retained. Protected cron and actual iPhone receipt/tap still require verification. |
| Subscriptions / seven-day trial | Apple products shown approved. Trial configuration, eligible-user purchase, restore and actual entitlement lifecycle have not been verified here as a complete release. |
| Saved tickets / Model Report | Code fixed: Model Report and slip-dependent settings follow the saved-slip flag; deep-link copy is honest. Preview/iPhone rollout remains. |
| Production diagnostic hiding | Multiple entry points were reported. Existing production visibility rules exist; a final sweep on the current production iPhone OTA is not confirmed. |
| Apple sign-up/sign-in / Face ID | Prior issues and fixes were discussed. New-user/returning-user/restore/reinstall device test closure is not confirmed here. |
| Advanced Coach prediction context | Some cached lineup/weather/workload/red-zone context is implemented. Soccer/tennis weather probability weights, advanced pitch/pressure/coverage feeds, projected minutes/limits, validated rest/travel effects, calibration and joint-ticket model improvements are not all completed by those batches. |
| Build 79 readiness | Full API/mobile typechecks and iOS export now pass locally. Physical-device/native-module matrix remains open; no new native build started. |

Recently closed: soccer team lookup/history PR #860 is deployed. Health verification returned deploymentSha ebab7beac43d73ebdfcc9ab8177d278ecf59e68f. The exact source team and ten real results were verified before deployment. iPhone page refresh is still a useful final UI check, but backend deployment is no longer pending.

Explicitly deferred requests (not claimed as work already started): guided onboarding tour and Coach voice. Fantasy cross-sport/profile saving also needs a separate current-state review before claiming completion or an implementation status.

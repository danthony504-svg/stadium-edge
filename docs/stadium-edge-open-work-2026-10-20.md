# Stadium Edge open work — October 20, 2026

This separates proven remaining work from older requests lacking end-to-end closure. A merged PR, enabled toggle, or approved subscription is not proof of live delivery.

| Work | Verified state / remaining step |
|---|---|
| Prop error audit | Implementing and validating request-level reports plus delivery checks. Needs preview OTA and iPhone validation. |
| Coach speed / empty free two-leg requests | Still open. Two current live tests returned zero picks after ~41–46s; loading/context used most of the budget. Earlier successful early-completion replay did not close this issue across conditions. |
| Free two-leg early completion and cancellation reporting | PR #859 merged. API portion is deployed as part of current main. Latest production mobile OTA / device verification is not confirmed here. |
| Automatic API deployment | GitHub deploy jobs skip because RENDER_DEPLOY_HOOK is missing. Manual deployment works; automation remains incomplete. |
| Referral rewards | Implementation exists, but activation requires migration, durable key, Apple week/month offer inventory, enable flag, mobile rollout and real-account redemption testing. No verified live closure in this thread. |
| Daily phone updates | Settings UI exists. Actual scheduled, fresh-data-driven delivery, token registration, preferences and tap destinations still need end-to-end verification for each advertised notification. |
| Subscriptions / seven-day trial | Apple products shown approved. Trial configuration, eligible-user purchase, restore and actual entitlement lifecycle have not been verified here as a complete release. |
| Saved tickets / Model Report | User reported an unusable report directing users to save unavailable tickets. A final consistent user flow is not confirmed in this thread. |
| Production diagnostic hiding | Multiple entry points were reported. Existing production visibility rules exist; a final sweep on the current production iPhone OTA is not confirmed. |
| Apple sign-up/sign-in / Face ID | Prior issues and fixes were discussed. New-user/returning-user/restore/reinstall device test closure is not confirmed here. |
| Advanced Coach prediction context | Some cached lineup/weather/workload/red-zone context is implemented. Soccer/tennis weather probability weights, advanced pitch/pressure/coverage feeds, projected minutes/limits, validated rest/travel effects, calibration and joint-ticket model improvements are not all completed by those batches. |
| Build 79 readiness | Final device matrix and existing repository typecheck failures remain open; do not label the entire repository or new native release ready. |

Recently closed: soccer team lookup/history PR #860 is deployed. Health verification returned deploymentSha ebab7beac43d73ebdfcc9ab8177d278ecf59e68f. The exact source team and ten real results were verified before deployment. iPhone page refresh is still a useful final UI check, but backend deployment is no longer pending.

Explicitly deferred requests (not claimed as work already started): guided onboarding tour and Coach voice. Fantasy cross-sport/profile saving also needs a separate current-state review before claiming completion or an implementation status.

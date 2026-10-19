# Build 78 production OTA release exception

Owner approval: 2026-10-18 22:10 America/Chicago. After being explicitly asked whether to lift the freeze and release without the unconfirmed 24-hour device test and without identifying the original October 14 exception, the owner instructed: “Ok update build 78”.

Scope: production iOS OTA for existing runtime 1.1.0; no native build, runtime change, authentication bypass, or fabricated verification marker. Release the merged Coach preview, composer visibility, sign-in diagnostics removal, and premium-screen authentication fixes.

Evidence: owner report shows production update 01a144bd-83bc-7ee4-8e43-3718b03c42b3 / b666165e8d21c85222ab2ff874b538394efac66a launched without embedded fallback or emergency launch; checks completed unavailable. A single network interruption recovered. Preview update 01a15213-4bc2-7347-bb40-cc38791f1983 was separately shown running.

Local checkout: 371 critical tests passed and iOS bundle export completed. This is not a substitute for CI on the merged release SHA. The existing Force production OTA workflow reruns critical tests and iOS export before publishing. Publication happens only if those steps succeed.

Known limits accepted by owner: original October 14 exception remains unidentified; 24-hour device smoke is unconfirmed; native build number absent from supplied report. Do not label these checks PASS or create .ota-testflight-verified.

Implementation: remove the active freeze under this explicit exception; update the existing .ota-force-publish trigger so merging starts the established production workflow. Keep reliability, runtime, production-environment, and compilation gates intact. No embedded rollback before publication. Verify successful EAS publication and new iOS update ID before reporting delivered; subsequently verify the production device applies the new ID.

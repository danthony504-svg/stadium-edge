# Automatic free two-leg Coach completion and cancellation reporting

## Evidence and limits

The user reported a 41.2s 0/2 scan-deadline alert and a separate 4.9s load cancellation. Both referenced older OTA `01a1544f…`. The exact requests and user identity are unknown. A guest auto-preview is a hypothesis, not an established attribution.

The actual automatic free request is a broad next-upcoming-games, different-markets two-leg ask. Replaying that exact template loaded 3,374 props/alts plus game lines. Before this change, one live replay returned two qualified picks only at about 41.0s, with `scan_deadline`/`timedOut=true`. The scan continued across the board after viable progressive results existed.

After this change, a separate live replay returned the same two B+ picks (86 and 82 confidence) at about 30.6s, with no timeout. Network/cache conditions differed, so these are observations, not a controlled latency benchmark or guaranteed reproduction of the user's incident. Loading and enrichment still consumed about 20.8s in that run.

## Completion rule

Only the exact automatic free two-leg templates (including the four existing styles) enable early completion. Ordinary user requests and larger tickets keep their existing behavior. Completion requires two already staged picks with different canonical markets, independent revalidation through the existing normal Coach quality authority, and no pending required prop slots or incomplete required prop phase. Explicit rejections, missing simulation provenance, low confidence/grades and non-positive edge/EV remain blocked.

The scan owns a child cancellation signal. Once the target is satisfied, it returns the staged ticket and aborts unfinished scan requests without aborting the caller's signal or generating a deadline/cancellation outcome. The manifest marks the ticket complete without falsely claiming the entire board was exhausted. If no qualifying complete ticket exists, normal scanning, deadline handling and honest shortfalls continue. No cached/unverified fallback, extra data calls or larger budget is introduced.

## Cancellation reporting

New clients emit `coach_cancelled` / `cancelled`, retained as a diagnostic event rather than an exception Telegram page. The API also recognizes the exact old-client signature: `coach_exception` + terminalStatus `cancelled` + rootCause `user_cancelled`. It normalizes that signature while preserving timings/request/update IDs. Real exceptions and scan-deadline events remain alertable. This does not establish whether an abort was a user's Stop, navigation or another caller cancellation.

## Validation / rollout

- 498 release-critical checks pass; 24 additional preview/perf/partial-emission checks pass.
- API bundle and iOS export pass. Repository-wide typecheck has existing failures and is not claimed green.
- Tests cover unchanged quality/variety gates, no premature required-prop completion, owned-work cancellation, caller cancellation, real error propagation and both legacy/new telemetry.
- Deploy the API before publishing the mobile preview so new cancellation events are accepted. Mobile early completion requires a preview OTA. No native build is required; no production OTA is published by this change.

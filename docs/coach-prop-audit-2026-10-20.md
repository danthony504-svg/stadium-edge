# Request-scoped prop audit

## Coverage

Each Coach build owns its collector. It records every prop row returned to that request's board loader (before the loader's date/team filters), plus rows added by expansion/recovery, simulation null reasons and graded candidates on both mixed-board and props-only paths. It does not fetch the world's entire sportsbook catalog or rerun simulations. Scope/grounding exclusions, never-simulated rows, failed simulations, scored quality failures, qualified-but-unselected rows and final selected rows are distinct outcomes. A qualified-but-unselected row is not labelled a proven correlation failure: the report does not invent a specific staging rejection reason.

Identity includes sport, event, athlete, raw market, side, threshold, price, book, player and matchup. Binary Yes/No null-line markets use the existing Over/Under 0.5 settlement normalization only for identity matching. The observed provider values remain in report rows. Delivery checks bind the exact captured quote and trusted simulation evidence, independently recheck normal quality floors and catch explicit player/side/line display conflicts. They do not infer current roster membership or price freshness from missing timestamps. Existing pre-simulation and final player/team grounding gates remain authoritative.

Reports contain request ID/time, terminal status, public sports fields, observed grade/confidence/edge/hit, simulation draw count and history count when observed. Missing fields remain null. Model null reasons such as insufficient_sample/stat_mapping_failed are preserved. A report is evidence about this request, not proof a rejected bet would lose or that a qualifying bet would win.

## Cost / storage / UI

Source snapshots and selected-pick checks use existing in-memory data; there are no new provider calls or simulation jobs. Detailed review runs in chunks of 100 after the build releases the foreground guard and yields to any newer foreground Coach build. Two reports are retained in memory; the newest completed report is saved locally. Reports cap retention at 50,000 unique rows and explicitly report omitted observation counts above the limit. The source quote index still covers captured rows so retention limits cannot reject a legitimate pick.

The existing diagnostics page has a test/development-only **Copy latest prop audit** button. No production Account/Home diagnostic entry is added. Local storage is best effort. iOS may suspend/terminate JavaScript before a deferred review finishes; only completed saved reports survive a relaunch. No closed-app background execution guarantee is made.

## Validation / limitations

- Unit regressions cover source quote mutation, simulation identity mismatch, display mismatch, genuine confidence floor, deferred immutable snapshots, truthful unrun/model failures, concurrent request isolation, cancellation/idempotence, binary normalization, chunking and foreground yielding.
- Local 4,000-row recording measured about 9ms in one Node run. This is not an iPhone latency guarantee.
- Live broad two-leg tests on October 20 returned no picks after about 41–46 seconds. Board loading and context consumed most of the deadline; there was no new audit-gate removal in those runs. This remains an open Coach speed issue, not a successful speed validation.
- The live deferred report correctly retained model null reasons and a timed-out terminal. It exposed that the original 10,000-row retention bound was too small for the current raw board; the bound was raised to 50,000 with explicit overflow disclosure.
- No live synthetic reliability/Telegram events were sent: replay tooling intercepted those outbound posts.

## Rollout

Mobile-only update, compatible with Build 78 / runtime 1.1.0. Publish PREVIEW_ONLY, build mixed and locked-market tickets on an iPhone, copy the report and verify selection, display and foreground/background behavior before production promotion. This change does not publish an OTA or resolve the separate load/context latency issue.

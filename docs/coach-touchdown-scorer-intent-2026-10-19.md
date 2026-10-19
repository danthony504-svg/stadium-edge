# Coach touchdown scorer intent

A bare request such as `5 leg touchdown`, `5 leg TD`, or `5 touchdowns` now selects **anytime touchdown scorers only**. It cannot substitute passing touchdowns, first-touchdown bets, or a No/Under anytime-TD side. Explicit passing/QB TDs, rushing TDs, receiving TDs and first TDs retain separate canonical market locks. Explicit Under requests are not rewritten into Yes requests.

The prior shared `fb_touchdowns` rule explicitly admitted passing TDs and first TDs. This is why Brock Purdy over 1.5 **passing** touchdowns appeared on a scorer request. Client and server rule catalogs now agree on the narrower intent. The initial pool, props-only builder, recovery and final ticket filter enforce it. No new network calls, simulation requests, lowered thresholds or filled-in missing stats are introduced.

## Validation

- 492 release-critical tests pass, including pool/final side filtering, exact explicit TD markets and direct/recovery-builder rejection before any network work.
- iOS Expo export and API bundle pass.
- Captured-board replay against the live API: 25 matching anytime scorer lines, all 25 selected, 19 graded, zero qualified, about 5.9 seconds. This is a captured-board replay, not a reconstruction of the device request or a recommendation.
- Four lines returned `insufficient_sample`: Brandin Cooks, Austin Ekeler, Luke McCaffrey and Malik Turner. Two returned `stat_mapping_failed`: Jayden Daniels and Brock Purdy anytime TD. Their scoring history does not supply the complete rushing/receiving scoring inputs required by the existing model. A missing receiving-TD column is not silently converted to zero, even for a QB; passing TDs cannot count as personal touchdowns.

These six are evidence shortfalls, not proven quality failures. They do not justify filling the ticket with passing TDs. The existing 52% confidence/C+ minimum and exact simulation provenance remain unchanged.

The mobile rule/filter changes require a preview OTA before device verification. No native build is needed. This change does not publish an OTA itself.

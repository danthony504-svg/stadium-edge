# NCAAF holdout funnel audit (2026-10-25)

Research-only. Does not enable Coach, approve a model, publish OTA or send notifications.

## Independently verified deployed state

Read from `GET /api/research/ncaaf/status` and `GET /api/research/ncaaf/ledger` (America/Chicago labeling for operator notes; API timestamps remain UTC):

| Field | Value |
|---|---|
| Authenticated / feature-complete development games | 24 / 24 |
| Frozen adjusted model SHA-256 | `5c244f3632ca99df222223e5bdb04d18d6c93e05ffe63556191367584c07d1a2` |
| Training games in freeze | 23 |
| Adjusted journal recorded / existing | 0 / 0 |
| Prior-season forecasts | 0 |
| Saved forecasts (all versions) | 49 |
| Research settlements linked | 42 |
| Ledger excluded: development_or_excluded_game | 25 |
| Ledger excluded: not_current_frozen_holdout | 24 |
| Independent holdout labelled forecasts | 0 |
| `qualifiedHoldoutGames` | null |
| Coach / releaseEligible | false / false |

Original research forecasts remain immutable inventory; they are not relabelled as the frozen model's independent holdout.

## Why zero independent forecasts are saved

### Evidence blockers (not software inventable)

1. **Official conference availability has not published for the upcoming slate.** Live public HD Intelligence feeds on 2026-10-25 showed only Oct 23–24 game reports. Archive rows with a future calendar day: **0** across B10/B12/ACC/SEC. Binding requires a verified published report day plus a unique pregame ESPN identity — without published reports, `eventBindingVerified` stays false.
2. **Prior-season pregame evidence does not exist** in the archive (`priorSeasonForecasts: 0`). Historical scores alone cannot create prospective forecasts for a second season.
3. **500 independent settled games across two seasons** remain unmet. Status correctly keeps `qualifiedHoldoutGames: null`.

### Code defects addressed in this change

1. **Opaque empty journal** — `/status` derives `waiting_for_holdout_contexts` when a frozen model exists and zero future holdout contexts are present (sealed `ncaafAdjustedModelStore.ts` / `ncaaf-context-dataset.mjs` bytes stay frozen-compatible so `implementationSha256` does not break journaling).
2. **Conference capture one-shot empty slots** — attempts with `verifiedEvents: 0` or `failed` become retryable after a 30-minute backoff; stale `running` attempts reclaim after 15 minutes so collector kills do not pin the slot.
3. **Completed odds slot skipped all free collectors** — free injury/conference/context refresh still runs without another Odds API charge.
4. **Conference bound before fresh odds** — conference capture now runs after the slot's live-input refresh so bindings see the current matched upcoming set.
5. **Catch-up injury refresh** — catch-up refreshes injuries for the journal's 6-hour window; injury failures are isolated and do not abort conference/usage/context.
6. **Operator funnel invisible** — `/status` exposes upcoming matched targets, verified bindings, context-dataset blockers and future holdout context counts.

### Not defects

- Withholding incomplete usage/history/venue contexts (retryable by design).
- Refusing to bind started games or ambiguous archive days.
- Hard `releaseEligible: false` until human review + 500/2-season acceptance.

## Settlement / pushes

`scoreRecordedForecast` records `result: "push"` with null Brier when the exact line pushes. Settlement links in the ledger remain **unauthenticated** outcome evidence (`settlement_links_do_not_verify_outcomes`). One settlement blocker was reported live as `settlement_unavailable_or_invalid: 1`. No write verification against production was performed from this agent.

## 500-game / two-season policy

Rationale: independent holdout must be large enough for calibration and market-baseline comparison, span more than one seasonal regime, use exact quote/line binding, and never count development or protocol-excluded games. A defensible **experimental research release** can exist as:

1. Frozen model + protocol hash (already present).
2. Prospectively recorded independent_holdout forecasts before kickoff with authenticated market/line/odds/source timestamps.
3. Settled outcomes including pushes, Brier/calibration vs market baseline.
4. Explicit human signoff that Coach remains disabled until the full 500/2-season bar (or a separately documented experimental charter with lower N) is met.

Do **not** silently lower the production acceptance constants or claim historical reconstructions are prospective forecasts.

## Release recommendation (for review)

- **Deploy backend-only** after CI: observability + retry/free-refresh fixes unblock mid-week binding once conferences publish.
- **Do not** enable subscriber Coach, approve the model, publish OTA or notify users.
- **Next evidence window:** when B10/B12/ACC/SEC publish reports for the Oct 30–31 slate, confirm `/status.holdoutFunnel.verifiedAvailabilityBindings > 0`, a `holdout_context` row with future kickoff, then an adjusted-journal `recorded > 0` forecast whose `modelSha256` matches the freeze and whose markets carry exact line/odds/source timestamps before kickoff.
- Preserve the original 29/49 forecast inventory; never rewrite them.

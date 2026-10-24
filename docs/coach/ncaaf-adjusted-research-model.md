# Fitted NCAAF context research candidate

This implements a research trainer and forward journal. It is not a fitted production model, independent acceptance evidence or an unlock. The existing Coach gate, 52%/C+ floors, football-period exclusions, subscription logic and 500-game/two-season acceptance rule remain unchanged.

## Inputs and fitting

`ncaaf-context-ridge-research-v1` fits regulation-score residuals against authenticated pregame development records. The reference mean is the earlier team scoring/allowing mean. Features are an intercept, the earlier opponent-ridge score delta, home/away venue indicator (zero only for an explicitly neutral venue), and separate observed participation shares for probable, questionable, doubtful, out, game-time-decision and unknown status in passing attempts, carries and receptions. Receptions are not targets or snaps. Status associations are observational; no causal QB penalty, player value or starter assumption is invented.

Features are rebuilt from each record's frozen as-of history and availability data. Later history, target outcomes in feature history, inconsistent game identity, unknown venue and missing usage families reject the example. Unknown availability remains an explicit feature, never an available/healthy label. Feature means/scales and ridge coefficients are fitted using development outcomes only; fixed experimental ridge=4 is not tuned against holdout data.

There are 21 coefficients. A predeclared development guard requires at least 23 distinct development games, plus observable opponent, venue and availability variation. This guard only permits an experimental fit; it is not sufficient for validation or release. The original 16 development games alone cannot satisfy it. Unsupported feature ranges and unseen neutral-site context are withheld during inference. Original score support (0–84) and compound-drive/OT distribution assumptions remain experimental and must be evaluated independently.

## Immutable candidate and source footprint

The worker first authenticates the prepared development manifest and rechecks the original source archives/labels. It freezes the first eligible candidate under a content hash and an immutable first-candidate pointer. It never retunes that candidate using later outcomes. Metadata records the exact implementation commit and source-code fingerprint, development manifest hash, standardized features, coefficients, supported ranges and all training/source game identities. The frozen OT support archive and every OT-support game are bound into the artifact and excluded from the independent holdout.

The protocol uses the database clock after fitting and preserves 10,000 draws, full-game settlement, 500 independent games and two seasons. A changed predictive implementation halts journal recording pending review. The source fingerprint spans the model, feature builder, journal and distribution/source helpers; unrelated app deployments do not alter it. A future season or changed ruleset still requires explicit compatibility work and review. The inherited OT transfer implementation currently supports 2026 research only; this change does not certify or silently extend it to later seasons.

## Frozen evaluation policy

The artifact predeclares a primary full-game spread pair per model/event and separate ML/total evaluation pairs, using fixed bookmaker priority, lexical fallback and ascending home line when multiple lines exist. The chosen exact pair is saved before kickoff and verified during settlement. Outcomes and model probabilities never enter quote selection. Pushes are excluded, bookmaker duplicates do not create extra games, and forecasts without a primary spread cannot qualify for that primary evaluation. Each market requires its own sample and baseline checks; spread acceptance does not approve ML or totals. This prevents choosing a favorable book/line retrospectively; it does not establish independent acceptance or validate the model.

## Prospective journal

Existing pre-freeze contexts stay development-only. New contexts captured after the frozen pointer exists are assigned `holdout_context` with the exact model/protocol hashes. They cannot enter development preparation or development outcome labeling. The new journal only consumes those new contexts after the actual candidate registration time, fresh captured odds and authenticated sources. It makes no extra provider/paid-odds calls.

Adjusted expected scores enter the 10,000-draw engine through explicit expected-score parameters. Observed team statistics are not overwritten. Original quotes/lines remain bound to their original event, side and bookmaker. Forecast keys contain the actual artifact hash; a database-clock-before-kickoff INSERT and conflict-do-nothing preserve the first record. Every original OT-transfer forecast remains unchanged and separate. Final scoring uses saved probabilities with exact market identity and excludes pushes from Brier scoring; it never reruns the model against the final result.

The research preview labels adjusted records separately and continues to mark every model unvalidated. The live status endpoint distinguishes implemented trainer/journal code, missing development outcomes, a fitted frozen research candidate and independent acceptance. No active Coach model is registered by this change. No mobile code or OTA is required for the research implementation.

## Verification and current limits

Logic tests use clearly synthetic data, not performance evidence. They cover deterministic fitting, observed-source/cutoff guards, training-volume and variation guards, unknown feature support, artifact tampering, availability effects reaching actual market simulations, future-only contexts, immutable writes, kickoff races, exact pushes, and waiting states without authentic data. The source/availability tests and full API regressions run separately.

Actual fitting remains contingent on enough authentic finalized development games. Market-baseline/calibration testing, injury/venue/OT validation, independent multi-season evidence, human release review and approved Coach integration are still required. No completion date or model accuracy is inferred from passing software tests.

# Pricing research replay

Run the comparison with a captured JSONL file from the repository root.

```sh
node --import ./artifacts/api-server/test/register-hooks.mjs artifacts/api-server/scripts/pricingResearchReplay.ts captures.jsonl
node --import ./artifacts/api-server/test/register-hooks.mjs --test artifacts/api-server/test/pricingResearch.test.ts
```

Each record carries an `id`, `kind`, forecast time `asOf`, `eventStartsAt`, `settledAt`, and a settled `result` of `win`, `loss`, `push`, or `void`. Times use Unix milliseconds. Optional `baselineProbability` and `baselineAvailableAt` preserve the existing model's pregame estimate for a paired comparison.

| Kind | Inputs |
| --- | --- |
| `fair` | Exact `market` and `side`, plus `quotes` with book, American odds, book quote time and actual receipt time. |
| `receptions` | Exact football receptions `market`, `projection` with timestamped completed games, a versioned prior, line, side, and next-game exposure in the prior's units. Supply `exposureAvailableAt` and, if using actual offered odds, `offeredPriceAvailableAt`. |
| `receiving_yards` | Same timestamps and exact-market inputs as `receptions`, with game-level targets and yards, a yards-per-target prior, and an optional pregame matchup multiplier. |
| `sgp_script` | A complete NFL script snapshot for both teams and supplied no-push leg marginals. Supported legs are passing yards and attempts, receptions, and receiving yards. Team target shares must sum to one, including any residual receiver group. |
| `sgp` | Same-event `pricing.legs` with supplied marginals and verified no-push settlement. Supply `marginalsAvailableAt`, the pregame version and fit cutoff of the latent correlation matrix, and, if using offered odds, `offeredPriceAvailableAt`. |

The TypeScript input shapes live in [replay.ts](./replay.ts). The report groups Brier score and log loss by module and sport, with paired scores on identical rows. Pushes and voids are excluded from binary scoring. A fair market probability is conditional on the bet settling without a push. Receptions forecasts report explicit push probability and compare EV to the actual offered price.

Use preregistered captures and independent holdouts for the upgrade plan’s release checks. This replay consumes supplied inputs. Persistent capture, automatic prior and correlation fitting, live model evaluation, structural coverage beyond the NFL passing game, and Coach integration are follow-on work.

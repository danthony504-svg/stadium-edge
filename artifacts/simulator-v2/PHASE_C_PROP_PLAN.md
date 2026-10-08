# Phase C — NFL/NCAAF Player Props (Planning)

**Status:** Planning only on the football stream. No settle enablement for `player_prop` yet.  
**Depends on:** Phase B joint scoring tensor (same draws).  
**Does not block:** NHL / basketball / MLB parallel streams.

## 1. Goals

1. Attach player participation + countable stats to the **same** joint football scenario tensor as FG/Q/H.
2. Settle main **and** alternate player props from that tensor (`settle` / `batchAlts`).
3. Preserve provider American odds; fail closed on missing participation or unmapped markets.
4. Chrono OOS for `nfl:player_prop` and `ncaaf:player_prop` independently before any allowlist ask.
5. Regression suite so alts are not dropped in discovery → normalize → grade → assembly.

## 2. Market catalog (provider — already in api-server)

| Tier | NFL | NCAAF |
|------|-----|-------|
| Core mains | pass/rush/rec yds & attempts, TDs, INT, sacks, anytime TD, … | Core skill + anytime TD |
| Extended | 1st TD, FG made, combo yds/TDs | Similar subset |
| DST | kicking pts, tackles, def INT | — |
| QH | pass/rush/rec yds Q1/H1 (+ pass TD Q1) | pass/rush/rec yds Q1/H1 |
| Alts | Wide yard/attempt/TD ladder | Yard ladder + extended alt batch |

Phase C v1 target: **core skill yards/receptions/pass attempts + anytime TD + matching `_alternate` keys**. DST and rare counts can follow as C.1 with separate family slices if needed.

## 3. Generative design (football-specific — not reusable as-is)

```
For each draw i in jointFootball tensor:
  sample game pace / team / quarter points (Phase B)
  for each rostered player with participation evidence:
    sample usage shares conditional on team pace + role
    sample discrete stats (Poisson / NegBin / Bernoulli TD)
    enforce soft caps vs team pass/rush attempt budgets (diagnostic reject if hard break)
```

- **Do not** call independent V1 prop Monte Carlo and paste onto V2 FG.
- **Do not** export these usage models into NHL/NBA packages — only shared RNG/settle utilities.

### Settlement paths (illustrative)

| Provider key | settlePath |
|--------------|------------|
| player_pass_yds | `players.{id}.stats.pass_yds` |
| player_rush_yds | `players.{id}.stats.rush_yds` |
| player_reception_yds | `players.{id}.stats.rec_yds` |
| player_receptions | `players.{id}.stats.receptions` |
| player_anytime_td | `players.{id}.stats.any_td` (Bernoulli / count>0) |
| *_alternate | same path, different `line` |

QH props settle on quarter/half slices of the same player tensor when Phase C.2 lands.

## 4. Data inputs

| Input | Source | Leak rule |
|-------|--------|-----------|
| Depth / starter | ESPN depth / injury | as-of < kickoff |
| Role priors | Trailing games form | kickoff < target |
| Opponent defense | Trailing allowed rates | kickoff < target |
| Weather | existing football wx features | pre-start |
| Listed lines | Odds props + alt batches | provenance required |

Missing starter evidence → `missing_data` reject for that player market (no filler).

## 5. Alt-prop integrity tests (required before settle support)

1. Fixture event with main 74.5 and alts 64.5 / 84.5 → all three settle from one tensor.
2. Normalize map: `player_pass_yds_alternate` → family `player_prop`, same playerId.
3. Unsupported key → reject, does not 422 wipe core catalog (mirror api-server batch isolation).
4. Ticket-assembly fixture: graded alt not removed by correlation/no-filler when it is the only qualifying rung (Coach rules unchanged — test at V2 settle boundary only).

## 6. Acceptance

Independent keys: `nfl:player_prop`, `ncaaf:player_prop`.

Thresholds identical to `acceptanceGates.ts`. Scoring family pass **does not** enable props.

## 7. Implementation slices

| Slice | Deliverable | Serve |
|-------|-------------|-------|
| C0 | This plan + coverage matrix rows | off |
| C1 | Prop columns on tensor + core settlePaths + unit tests | off |
| C2 | Alt ladder batch + QH optional | off |
| C3 | Chrono OOS report ≥500 | off |
| C4 | Human review → optional allowlist (separate approval) | still default off |

## 8. Branch

`cursor/sim-v2-football-props-*-def8` branched from Phase B correct once C1 starts. Keep Phase B scoring fixes on the current correct branch until stable.

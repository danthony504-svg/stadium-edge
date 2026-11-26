import { DEFAULT_FIRST_BASKET_USAGE_PRIOR, firstScore, openingGameSummary, priceFirstBasket, type OpeningGame } from "./nbaFirstBasketModel.js";
import type { FirstBasketEvaluationCase } from "./nbaFirstBasketBacktest.js";

const priorGrid = [5, 15, DEFAULT_FIRST_BASKET_USAGE_PRIOR, 70];

export function tuneFirstBasketUsage(input: {
  history: readonly OpeningGame[];
  cases: readonly FirstBasketEvaluationCase[];
  strengths?: readonly number[];
}) {
  const games = [...input.cases].sort((a, b) => a.snapshot.startsAt - b.snapshot.startsAt);
  const strengths = [...new Set(input.strengths ?? priorGrid)];
  if (!strengths.length || strengths.some(strength => !Number.isFinite(strength) || strength < 0)) {
    throw new RangeError("Invalid usage prior grid");
  }
  if (new Set(games.map(game => game.snapshot.eventId)).size !== games.length) throw new RangeError("Duplicate tuning game");
  const times = [...new Set(games.map(game => game.snapshot.startsAt))];
  const tuningBlocks = Math.min(4, times.length - 1);
  if (tuningBlocks < 1) return { selectedStrength: null, development: [], holdout: null };
  // Group simultaneous games. The final time block stays untouched during selection.
  const blockCount = tuningBlocks + 1;
  const blocks = new Map(times.map((time, index) => [time, Math.floor(index * blockCount / times.length)]));
  const records = [...input.history];
  for (const { snapshot, final } of games) {
    if (!openingGameSummary(final) || final.eventId !== snapshot.eventId || final.finalAt <= snapshot.startsAt ||
        final.teams[0].id !== snapshot.home.id || final.teams[1].id !== snapshot.away.id) {
      throw new RangeError("Invalid usage tuning final");
    }
    records.push(final);
  }
  const score = (strength: number, startBlock: number, endBlock: number) => {
    let count = 0, loss = 0;
    let evaluatedGames = 0;
    for (const { snapshot, final } of games) {
      const block = blocks.get(snapshot.startsAt)!;
      if (block < startBlock || block >= endBlock) continue;
      const prediction = priceFirstBasket(snapshot, records, [], snapshot.availableAt, strength);
      if (prediction.status !== "ready") continue;
      let used = false;
      for (const side of [0, 1] as const) {
        const scorer = firstScore(final, "field_goal", side);
        if (!scorer) continue;
        const outcome = prediction.outcomeProbabilities.find(item => item.rule === "field_goal" &&
          item.market === "player_first_team_basket" && item.playerId === scorer.playerId);
        if (!outcome || ![snapshot.home, snapshot.away][side]!.starters.some(player => player.id === scorer.playerId)) continue;
        count++;
        loss -= Math.log(Math.max(1e-12, outcome.probability));
        used = true;
      }
      if (used) evaluatedGames++;
    }
    return { strength, games: evaluatedGames, outcomes: count, logLoss: count ? loss / count : null };
  };
  const development = strengths.map(strength => {
    const folds = Array.from({ length: tuningBlocks }, (_, i) => score(strength, i, i + 1));
    const outcomes = folds.reduce((sum, fold) => sum + fold.outcomes, 0);
    const loss = folds.reduce((sum, fold) => sum + (fold.logLoss ?? 0) * fold.outcomes, 0);
    return { strength, folds, outcomes, logLoss: outcomes ? loss / outcomes : null };
  });
  const selected = development.filter(result => result.logLoss != null).sort((a, b) =>
    a.logLoss! - b.logLoss! || Math.abs(a.strength - DEFAULT_FIRST_BASKET_USAGE_PRIOR) -
    Math.abs(b.strength - DEFAULT_FIRST_BASKET_USAGE_PRIOR))[0];
  if (!selected) return { selectedStrength: null, development, holdout: null };
  const holdout = score(selected.strength, tuningBlocks, blockCount);
  return { selectedStrength: selected.strength, development,
    holdout: { selected: holdout, baseline: selected.strength === DEFAULT_FIRST_BASKET_USAGE_PRIOR
      ? holdout : score(DEFAULT_FIRST_BASKET_USAGE_PRIOR, tuningBlocks, blockCount) } };
}

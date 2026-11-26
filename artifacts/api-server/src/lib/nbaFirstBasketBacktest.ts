import { firstScore, openingGameSummary, priceFirstBasket, type FirstBasketSnapshot, type OpeningGame, type Rule, type Side } from "./nbaFirstBasketModel.js";
import { archiveLineupKey, MINUTE, type FirstBasketArchiveRecord } from "./nbaFirstBasketArchive.js";
import { firstBasketQuotes, type RawFirstBasketOdds } from "./nbaFirstBasketOdds.js";

export type FirstBasketEvaluationCase = {
  snapshot: FirstBasketSnapshot;
  final: OpeningGame;
  closing?: { at: number; odds: RawFirstBasketOdds };
};
/** Build paired cases from pre-tip observations archived by the collector. */
export function archivedFirstBasketCases(records: readonly FirstBasketArchiveRecord[], finals: readonly OpeningGame[]) {
  return finals.flatMap<FirstBasketEvaluationCase>(final => {
    const lineups = records.flatMap(record => {
      if (record.kind !== "lineup" || record.snapshot.eventId !== final.eventId ||
          record.snapshot.home.id !== final.teams[0].id || record.snapshot.away.id !== final.teams[1].id ||
          record.at < record.snapshot.availableAt || record.at >= record.snapshot.startsAt) return [];
      return [record];
    }).sort((a, b) => b.snapshot.availableAt - a.snapshot.availableAt);
    const lastLineup = lineups[0]?.snapshot;
    if (!lastLineup || lastLineup.confirmedAt == null || lastLineup.startsAt - lastLineup.confirmedAt > 45 * MINUTE) return [];
    const key = archiveLineupKey(lastLineup, lastLineup.startsAt - 1);
    const pretip = records.filter(record => record.kind === "odds" && record.eventId === final.eventId && record.key === key &&
      record.at < lastLineup.startsAt && lastLineup.startsAt - record.at <= 5 * MINUTE)
      .sort((a, b) => b.at - a.at)[0];
    if (pretip?.kind !== "odds" || !pretip.response) return [{ snapshot: lastLineup, final }];
    const pricingLineup = lineups.find(record => record.at <= pretip.at &&
      archiveLineupKey(record.snapshot, pretip.at) === key)?.snapshot;
    if (!pricingLineup || pricingLineup.confirmedAt == null) return [{ snapshot: lastLineup, final }];
    return [{ snapshot: pricingLineup, final, closing: { at: pretip.at, odds: pretip.response } }];
  });
}

type Binary = { probability: number; outcome: number };
const logLoss = (p: number) => -Math.log(Math.max(1e-12, p));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function calibration(rows: Binary[]) {
  return {
    games: rows.length,
    brier: mean(rows.map(row => (row.probability - row.outcome) ** 2)),
    logLoss: mean(rows.map(row => logLoss(row.outcome ? row.probability : 1 - row.probability))),
    buckets: Array.from({ length: 10 }, (_, i) => {
      const bucket = rows.filter(row => Math.min(9, Math.floor(row.probability * 10)) === i);
      const predicted = mean(bucket.map(row => row.probability));
      const actual = mean(bucket.map(row => row.outcome));
      const absoluteGapPp = predicted != null && actual != null ? Math.abs(predicted - actual) * 100 : null;
      return { lower: i / 10, games: bucket.length, predicted, actual, absoluteGapPp,
        belowTwoPointTarget: absoluteGapPp == null ? null : absoluteGapPp < 2 };
    }),
  };
}

export function backtestNbaFirstBasket(input: {
  history: readonly OpeningGame[];
  cases: readonly FirstBasketEvaluationCase[];
  usagePriorStrength?: number;
  includeClosing?: boolean;
}) {
  const seen = new Set<string>();
  const tip: Binary[] = [], firstPoints: Binary[] = [], firstFieldGoal: Binary[] = [];
  const markets = new Map<string, { model: number[]; closing: number[] }>();
  let skipped = 0, gamesWithClosingFields = 0;
  const evaluatedStarts: number[] = [];
  for (const { snapshot, final, closing } of input.cases) {
    const observed = openingGameSummary(final);
    if (!observed || final.eventId !== snapshot.eventId || final.finalAt <= snapshot.startsAt || seen.has(final.eventId) ||
        observed.teams[0].id !== snapshot.home.id || observed.teams[1].id !== snapshot.away.id ||
        (closing && (!Number.isFinite(closing.at) || closing.at < snapshot.availableAt || closing.at >= snapshot.startsAt))) {
      throw new RangeError("Invalid or duplicate First Basket evaluation game");
    }
    seen.add(final.eventId);
    const prediction = priceFirstBasket(snapshot, input.history, [], snapshot.availableAt, input.usagePriorStrength);
    if (prediction.status !== "ready") { skipped++; continue; }
    evaluatedStarts.push(snapshot.startsAt);
    tip.push({ probability: prediction.homeTipWin, outcome: Number(observed.tipWinner === 0) });
    firstPoints.push({ probability: prediction.homeScoresFirst.points, outcome: Number(observed.firstPoints.side === 0) });
    firstFieldGoal.push({ probability: prediction.homeScoresFirst.field_goal, outcome: Number(observed.firstFieldGoal.side === 0) });
    if (!closing || input.includeClosing === false) continue;

    const sameFives = [snapshot.home, snapshot.away].every((team, side) =>
      team.starters.every(player => final.teams[side]!.starters.includes(player.id)));
    if (!sameFives) continue;
    const playerSide = new Map([snapshot.home, snapshot.away].flatMap((team, side) =>
      team.starters.map(player => [player.id, side as Side] as const)));
    const fields = new Map<string, ReturnType<typeof firstBasketQuotes>>();
    for (const quote of firstBasketQuotes(snapshot, closing.odds, closing.at)) {
      if (!quote.completeField || quote.noVig == null) continue;
      const team = quote.market === "player_first_team_basket" ? playerSide.get(quote.playerId) : null;
      const key = JSON.stringify([quote.book, quote.rule, quote.market, team]);
      const field = fields.get(key) ?? [];
      field.push(quote);
      fields.set(key, field);
    }
    let matched = false;
    for (const [key, field] of fields) {
      const [, rule, market, team] = JSON.parse(key) as [string, Rule, typeof field[number]["market"], Side | null];
      const realized = firstScore(final, rule, team ?? undefined);
      if (!realized) continue;
      const method = market === "player_method_of_first_basket" ? realized.method : null;
      const winner = field.find(quote => quote.playerId === realized.playerId && (quote.method ?? null) === method);
      if (!winner) continue;
      const lookup = (playerId: string, scoreMethod?: string) => prediction.outcomeProbabilities.find(prob =>
        prob.rule === rule && prob.market === market && prob.playerId === playerId && prob.method === (scoreMethod ?? null))?.probability ?? 0;
      const modelMass = field.reduce((sum, quote) => sum + lookup(quote.playerId, quote.method), 0);
      const closingMass = field.reduce((sum, quote) => sum + quote.noVig!, 0);
      if (Math.abs(modelMass - 1) > 1e-8 || Math.abs(closingMass - 1) > 1e-8) continue;
      const marketKey = JSON.stringify([winner.book, rule, market, team == null ? "game" : "team"]);
      const totals = markets.get(marketKey) ?? { model: [], closing: [] };
      totals.model.push(logLoss(lookup(winner.playerId, winner.method)));
      totals.closing.push(logLoss(winner.noVig!));
      markets.set(marketKey, totals);
      matched = true;
    }
    if (matched) gamesWithClosingFields++;
  }

  return {
    suppliedGames: seen.size, skipped,
    stage1: {
      targetGapPp: 2,
      firstGameAt: evaluatedStarts.length ? Math.min(...evaluatedStarts) : null,
      lastGameAt: evaluatedStarts.length ? Math.max(...evaluatedStarts) : null,
      tip: calibration(tip), firstPoints: calibration(firstPoints), firstFieldGoal: calibration(firstFieldGoal),
    },
    stage2: {
      gamesWithClosingFields,
      comparisons: [...markets].map(([key, losses]) => {
        const [book, rule, market, scope] = JSON.parse(key) as [string, Rule, string, string];
        return { book, rule, market, scope, fields: losses.model.length,
          modelLogLoss: mean(losses.model), closingNoVigLogLoss: mean(losses.closing),
          pairedDifference: mean(losses.model.map((loss, i) => loss - losses.closing[i]!)) };
      }),
    },
  };
}

import { fairConsensus, marketKey, type BookQuote, type MarketIdentity, type Side } from "./fairOdds.js";
import { receptionPosterior } from "./receptions.js";
import { sameGameCopula } from "./sameGame.js";

type Result = "win" | "loss" | "push" | "void";
type Common = {
  id: string;
  asOf: number;
  eventStartsAt: number;
  settledAt: number;
  result: Result;
  baselineProbability?: number;
  baselineAvailableAt?: number;
};
type Input = Common & (
  | { kind: "fair"; market: MarketIdentity; side: Side; quotes: BookQuote[] }
  | { kind: "receptions"; market: MarketIdentity; projection: Omit<Parameters<typeof receptionPosterior>[0], "asOf">; exposureAvailableAt: number; offeredPriceAvailableAt?: number }
  | { kind: "sgp"; pricing: Omit<Parameters<typeof sameGameCopula>[0], "asOf">; marginalsAvailableAt: number; offeredPriceAvailableAt?: number }
);

type Score = { count: number; brierSum: number; logLossSum: number };
function observe(score: Score, forecast: number, actual: number) {
  const bounded = Math.max(1e-12, Math.min(1 - 1e-12, forecast));
  score.count++;
  score.brierSum += (forecast - actual) ** 2;
  score.logLossSum -= actual ? Math.log(bounded) : Math.log1p(-bounded);
}
function metrics(score: Score) {
  return {
    count: score.count,
    brier: score.count ? score.brierSum / score.count : null,
    logLoss: score.count ? score.logLossSum / score.count : null,
  };
}

/** Read-only comparison on captured forecasts. Baselines are compared on the same scored rows. */
export function replayPricing(rows: readonly Input[]) {
  const seen = new Set<string>();
  const summaries = new Map<string, {
    skipped: number; current: Score; paired: Score; baseline: Score;
  }>();
  const forecasts = rows.map(row => {
    if (!row.id || seen.has(row.id) ||
        ![row.asOf, row.eventStartsAt, row.settledAt].every(Number.isFinite) ||
        !(row.asOf < row.eventStartsAt && row.eventStartsAt <= row.settledAt) ||
        !["win", "loss", "push", "void"].includes(row.result) ||
        (row.baselineProbability != null && (!(row.baselineProbability >= 0 && row.baselineProbability <= 1) ||
          !Number.isFinite(row.baselineAvailableAt) || row.baselineAvailableAt! >= row.asOf))) {
      throw new RangeError(`Invalid, duplicate, or non-pregame replay record: ${row.id}`);
    }
    seen.add(row.id);
    let probability: number | null;
    let details: unknown;
    let baseline = row.baselineProbability;
    const availableBeforeForecast = (timestamp: number | undefined) =>
      timestamp != null && Number.isFinite(timestamp) && timestamp < row.asOf;
    if (row.kind === "fair") {
      if (!["over", "under"].includes(row.side)) throw new RangeError("Replay side is invalid");
      const fair = fairConsensus(row.market, row.quotes, { asOf: row.asOf });
      probability = fair ? row.side === "over" ? fair.probability : 1 - fair.probability : null;
      details = fair && { ...fair, marketId: marketKey(row.market, row.side), probability };
    } else if (row.kind === "receptions") {
      const projection = row.projection;
      if (!["nfl", "ncaaf"].includes(row.market.sport) ||
          row.market.market.replace(/_alternate$/, "") !== "player_receptions" ||
          row.market.line !== projection.line ||
          projection.games.some(game => game.eventId === row.market.eventId)) throw new RangeError("Mismatched receptions market");
      if (!availableBeforeForecast(row.exposureAvailableAt) ||
          (projection.offeredAmerican != null && !availableBeforeForecast(row.offeredPriceAvailableAt))) {
        throw new RangeError("Reception exposure or offered price was unavailable before the forecast");
      }
      const { draws: _draws, ...result } = receptionPosterior({ ...projection, asOf: row.asOf });
      probability = result.pushProbability < 1 ? Math.min(1, result.probability / (1 - result.pushProbability)) : null;
      details = { ...result, marketId: marketKey(row.market, projection.side), scoredProbabilityBasis: "conditional_on_no_push" };
    } else if (row.kind === "sgp") {
      if (!availableBeforeForecast(row.marginalsAvailableAt) ||
          (row.pricing.offeredAmerican != null && !availableBeforeForecast(row.offeredPriceAvailableAt))) {
        throw new RangeError("SGP marginals or offered price were unavailable before the forecast");
      }
      const result = sameGameCopula({ ...row.pricing, asOf: row.asOf });
      probability = result.joint;
      baseline ??= result.independent;
      details = result;
    } else {
      throw new RangeError("Unknown pricing replay kind");
    }

    const summaryKey = JSON.stringify([row.kind, row.kind === "sgp" ? row.pricing.legs[0]!.market.sport : row.market.sport]);
    let summary = summaries.get(summaryKey);
    if (!summary) {
      const empty = () => ({ count: 0, brierSum: 0, logLossSum: 0 });
      summary = { skipped: 0, current: empty(), paired: empty(), baseline: empty() };
      summaries.set(summaryKey, summary);
    }
    if (probability == null || row.result === "push" || row.result === "void") summary.skipped++;
    else {
      const actual = row.result === "win" ? 1 : 0;
      observe(summary.current, probability, actual);
      if (baseline != null) {
        observe(summary.baseline, baseline, actual);
        observe(summary.paired, probability, actual);
      }
    }
    return { id: row.id, kind: row.kind, probability, baselineProbability: baseline ?? null, details };
  });

  return {
    mode: "research_replay" as const,
    forecasts,
    summaries: [...summaries].map(([key, score]) => {
      const [kind, sport] = JSON.parse(key) as [string, string];
      return { kind, sport, skipped: score.skipped, proposed: metrics(score.current),
        pairedProposed: metrics(score.paired), pairedBaseline: metrics(score.baseline) };
    }),
  };
}

import { americanToProb } from "../oddsAltDevig.js";

export type DevigMethod = "multiplicative" | "additive" | "power" | "shin" | "odds_ratio";

export function fairAmerican(p: number): number | null {
  if (!(p > 0 && p < 1)) return null;
  return p <= 0.5 ? 100 * (1 - p) / p : -100 * p / (1 - p);
}

function bisect(low: number, high: number, fn: (x: number) => number): number {
  const lowSign = Math.sign(fn(low));
  if (lowSign === 0) return low;
  if (Math.sign(fn(high)) === lowSign) throw new RangeError("Root is outside the search bracket");
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    const y = fn(mid);
    if (Math.abs(y) < 1e-13) return mid;
    if (Math.sign(y) === lowSign) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function devig(q: readonly number[], method: DevigMethod = "odds_ratio") {
  if (q.length < 2 || q.some(p => !(p > 0 && p < 1))) throw new RangeError("Invalid implied probabilities");
  const sum = q.reduce((total, p) => total + p, 0);
  const margin = sum - 1;
  if (sum <= 1 || method === "multiplicative") {
    return { probabilities: q.map(p => p / sum), margin, method: "multiplicative" as const };
  }

  let probabilities: number[];
  if (method === "additive" || (method === "shin" && q.length === 2)) {
    probabilities = q.map(p => p - margin / q.length);
    if (probabilities.some(p => p <= 0)) return devig(q, "power");
  } else if (method === "power") {
    const upper = Math.log(q.length * 2) / -Math.log(Math.max(...q));
    const k = bisect(1, upper, x => q.reduce((total, p) => total + p ** x, 0) - 1);
    probabilities = q.map(p => p ** k);
  } else if (method === "shin") {
    const implied = (p: number, z: number) => {
      const a = p ** 2 / sum;
      return 2 * a / (Math.sqrt(z ** 2 + 4 * (1 - z) * a) + z);
    };
    const z = bisect(0, 1, x => q.reduce((total, p) => total + implied(p, x), 0) - 1);
    probabilities = q.map(p => implied(p, z));
  } else {
    const shifted = (p: number, logRatio: number) => p / (p + Math.exp(logRatio) * (1 - p));
    const logRatio = bisect(0, 50, x => q.reduce((total, p) => total + shifted(p, x), 0) - 1);
    probabilities = q.map(p => shifted(p, logRatio));
  }
  return { probabilities, margin, method };
}

const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
}

export type MarketIdentity = {
  sport: string;
  eventId: string;
  entityId: string;
  market: string;
  period: string;
  line: number;
};
export type Side = "over" | "under";

export function marketKey(m: MarketIdentity, side?: Side): string {
  if (![m.sport, m.eventId, m.entityId, m.market, m.period].every(x => typeof x === "string" && x.trim()) ||
      !Number.isFinite(m.line)) throw new RangeError("Incomplete market identity");
  return JSON.stringify([m.sport, m.eventId, m.entityId, m.market.replace(/_alternate$/, ""), m.period, m.line, side ?? null]);
}

export type BookQuote = {
  market: MarketIdentity;
  book: string;
  side: Side;
  american: number;
  quotedAt: number;
  receivedAt: number;
};

export function fairConsensus(market: MarketIdentity, quotes: readonly BookQuote[], opts: {
  asOf: number;
  method?: DevigMethod;
  maxAgeMs?: number;
  halfLifeMs?: number;
  bookWeights?: Readonly<Record<string, number>>;
}) {
  const key = marketKey(market);
  const { asOf, method = "odds_ratio", maxAgeMs = 15 * 60_000, halfLifeMs = 300_000 } = opts;
  if (!Number.isFinite(asOf) || !(maxAgeMs > 0) || !(halfLifeMs > 0)) throw new RangeError("Invalid quote window");
  const byBook = new Map<string, Partial<Record<Side, BookQuote>>>();
  for (const quote of quotes) {
    if (marketKey(quote.market) !== key || !quote.book || !["over", "under"].includes(quote.side) ||
        !Number.isFinite(quote.american) || Math.abs(quote.american) < 100 ||
        !Number.isFinite(quote.quotedAt) || !Number.isFinite(quote.receivedAt) ||
        quote.quotedAt > quote.receivedAt || quote.receivedAt >= asOf || asOf - quote.quotedAt > maxAgeMs) continue;
    const book = byBook.get(quote.book) ?? {};
    const previous = book[quote.side];
    if (!previous || previous.quotedAt < quote.quotedAt ||
        (previous.quotedAt === quote.quotedAt && previous.receivedAt < quote.receivedAt)) book[quote.side] = quote;
    byBook.set(quote.book, book);
  }
  const pairs = [...byBook.entries()].flatMap(([book, sides]) => {
    if (!sides.over || !sides.under) return [];
    const a = sides.over, b = sides.under;
    const result = devig([americanToProb(a.american), americanToProb(b.american)], method);
    const sharpness = opts.bookWeights?.[book] ?? 1;
    if (!Number.isFinite(sharpness) || sharpness <= 0) return [];
    const age = asOf - Math.min(a.quotedAt, b.quotedAt);
    return [{
      book, method: result.method, margin: result.margin, x: logit(result.probabilities[0]!),
      weight: sharpness * 0.5 ** (age / halfLifeMs) / Math.max(0.005, result.margin),
    }];
  }).filter(pair => pair.weight > 0 && Number.isFinite(pair.weight));

  if (!pairs.length) return null;
  const mid = median(pairs.map(pair => pair.x));
  const mad = 1.4826 * median(pairs.map(pair => Math.abs(pair.x - mid)));
  const kept = pairs.length >= 4 ? pairs.filter(pair => Math.abs(pair.x - mid) <= 3 * mad + 1e-12) : pairs;
  if (!kept.length) return null;
  const weight = kept.reduce((sum, pair) => sum + pair.weight, 0);
  const mean = kept.reduce((sum, pair) => sum + pair.weight * pair.x, 0) / weight;
  const effectiveBooks = weight ** 2 / kept.reduce((sum, pair) => sum + pair.weight ** 2, 0);
  const deviation = Math.sqrt(kept.reduce((sum, pair) => sum + pair.weight * (pair.x - mean) ** 2, 0) / weight);
  const halfWidth = 1.2815515655 * deviation / Math.sqrt(effectiveBooks);
  const probability = logistic(mean);
  return {
    marketId: marketKey(market, "over"), asOf, probability, fairAmerican: fairAmerican(probability),
    requestedMethod: method, methodsUsed: [...new Set(kept.map(pair => pair.method))],
    medianMargin: median(kept.map(pair => pair.margin)), booksUsed: kept.map(pair => pair.book),
    effectiveBooks, ci80: kept.length >= 2 ? [logistic(mean - halfWidth), logistic(mean + halfWidth)] : null,
    probabilityBasis: "conditional_on_no_push" as const,
  };
}

export function reconstructOneSided(american: number, assumedMargin: number) {
  if (!Number.isFinite(american) || Math.abs(american) < 100 || !Number.isFinite(assumedMargin) || assumedMargin < 0) return null;
  const implied = americanToProb(american);
  const otherSide = 1 + assumedMargin - implied;
  if (!(otherSide > 0 && otherSide < 1)) return null;
  return {
    probability: devig([implied, otherSide]).probabilities[0]!,
    assumedMargin, source: "reconstructed" as const,
  };
}

type Rung = { line: number; probability: number; weight: number };
export function repairLadder(rungs: readonly Rung[]): Rung[] {
  const sorted = [...rungs].sort((a, b) => a.line - b.line);
  const blocks: { from: number; through: number; weight: number; total: number }[] = [];
  for (const [index, rung] of sorted.entries()) {
    if (!Number.isFinite(rung.line) || !(rung.probability > 0 && rung.probability < 1) ||
        !(rung.weight > 0 && Number.isFinite(rung.weight)) || rung.line === sorted[index - 1]?.line) {
      throw new RangeError("Invalid or duplicate alt line");
    }
    blocks.push({ from: index, through: index, weight: rung.weight, total: rung.weight * rung.probability });
    while (blocks.length > 1) {
      const right = blocks.at(-1)!, left = blocks.at(-2)!;
      if (left.total / left.weight >= right.total / right.weight) break;
      blocks.pop();
      left.through = right.through;
      left.weight += right.weight;
      left.total += right.total;
    }
  }
  return blocks.flatMap(block => sorted.slice(block.from, block.through + 1).map(rung => ({
    ...rung, probability: block.total / block.weight,
  })));
}

export function interpolateLadder(repaired: readonly Rung[], line: number): number | null {
  const upper = repaired.findIndex(rung => rung.line >= line);
  if (upper < 0) return null;
  const right = repaired[upper]!;
  if (right.line === line) return right.probability;
  if (upper === 0) return null;
  const left = repaired[upper - 1]!;
  const t = (line - left.line) / (right.line - left.line);
  return logistic((1 - t) * logit(left.probability) + t * logit(right.probability));
}

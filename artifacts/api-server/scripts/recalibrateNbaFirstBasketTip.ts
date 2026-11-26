import { readFile } from "node:fs/promises";
import { firstBasketCalibration, type FirstBasketEvaluationCase } from "../src/lib/nbaFirstBasketBacktest.js";
import { pairedGameLossBootstrap } from "../src/lib/nbaFirstBasketIntervals.js";
import { DEFAULT_FIRST_BASKET_USAGE_PRIOR, openingGameSummary, priceFirstBasket, type OpeningGame } from "../src/lib/nbaFirstBasketModel.js";

type Replay = { history: OpeningGame[]; cases: FirstBasketEvaluationCase[] };
type Row = { probability: number; outcome: number };

const logOdds = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const loss = ({ probability, outcome }: Row) => -Math.log(Math.max(1e-12, outcome ? probability : 1 - probability));

// Each row describes the home side. Its mirror uses the opposite sign for both
// the log-odds and the home term, and has the complementary outcome.
function fit(rows: Row[], options: { slopePenalty?: number; fixedSlope?: boolean; initialHomeOffset?: number } = {}) {
  const { slopePenalty = 0, fixedSlope = false, initialHomeOffset = 0 } = options;
  let homeOffset = initialHomeOffset;
  let slope = 1;
  for (let i = 0; i < 40; i++) {
    let error = 0, weightedError = -slopePenalty * (slope - 1);
    let h00 = 0, h01 = 0, h11 = slopePenalty;
    for (const row of rows) {
      const x = logOdds(row.probability);
      const p = logistic(homeOffset + slope * x);
      const residual = row.outcome - p;
      const weight = p * (1 - p);
      error += residual;
      weightedError += residual * x;
      h00 += weight;
      h01 += weight * x;
      h11 += weight * x * x;
    }
    const determinant = h00 * h11 - h01 * h01;
    if (!(h00 > 0) || (!fixedSlope && !(determinant > 0))) {
      throw new Error("Tip fit needs both outcomes and varying forecasts");
    }
    const moveHomeOffset = fixedSlope ? error / h00 : (h11 * error - h01 * weightedError) / determinant;
    const moveSlope = fixedSlope ? 0 : (h00 * weightedError - h01 * error) / determinant;
    homeOffset += moveHomeOffset;
    slope += moveSlope;
    if (Math.max(Math.abs(moveHomeOffset), Math.abs(moveSlope)) < 1e-10) {
      return { homeOffset, slope, slopePenalty };
    }
  }
  throw new Error("Tip fit did not converge");
}

function replay(input: Replay, holdout: boolean) {
  const seen = new Set<string>();
  return [...input.cases].sort((a, b) => a.snapshot.startsAt - b.snapshot.startsAt).flatMap(({ snapshot, final }) => {
    const opening = openingGameSummary(final);
    if (!opening || snapshot.eventId !== final.eventId || seen.has(final.eventId) ||
        snapshot.startsAt >= final.finalAt || snapshot.home.id !== final.teams[0].id || snapshot.away.id !== final.teams[1].id) {
      throw new Error("Invalid or duplicate First Basket replay game");
    }
    seen.add(final.eventId);
    const sensitivity = { draws: 0, low: 0, high: 0 };
    const result = priceFirstBasket(snapshot, input.history, [], snapshot.availableAt, DEFAULT_FIRST_BASKET_USAGE_PRIOR,
      holdout ? (rule, tip, swing) => {
        if (rule !== "points") return;
        sensitivity.draws++;
        sensitivity.low += swing * tip;
        sensitivity.high += swing * (1 - tip);
      } : undefined);
    if (result.status !== "ready") return [];
    const tip = { probability: result.homeTipWin, outcome: Number(final.tipWinner === 0) };
    const points = { probability: result.homeScoresFirst.points, outcome: Number(opening.firstPoints.side === 0) };
    return [{ tip, points, sensitivity }];
  });
}

function compare(baseline: Row[], adjusted: Row[]) {
  return {
    baseline: firstBasketCalibration(baseline),
    adjusted: firstBasketCalibration(adjusted),
    pairedLogLossGain: pairedGameLossBootstrap(baseline.map((row, i) => ({
      baselineLoss: loss(row), selectedLoss: loss(adjusted[i]!), outcomes: 1,
    }))),
  };
}

const [fitPath, scorePath] = process.argv.slice(2);
if (!fitPath || !scorePath) throw new Error("Pass separate normalized fit and holdout replay JSON files");
const [train, holdout] = await Promise.all([fitPath, scorePath].map(async path => JSON.parse(await readFile(path, "utf8")) as Replay));
if (!train || !holdout || !train.cases.length || !holdout.cases.length ||
    Math.max(...train.cases.map(row => row.snapshot.startsAt)) >= Math.min(...holdout.cases.map(row => row.snapshot.startsAt))) {
  throw new Error("The complete fit cohort must precede the holdout");
}
const training = replay(train, false).map(row => row.tip);
const homeOnly = fit(training, { fixedSlope: true });
const ridge = fit(training, { initialHomeOffset: homeOnly.homeOffset, slopePenalty: 20 });
const scored = replay(holdout, true);
const baselineTip = scored.map(row => row.tip);
const points = scored.map(row => row.points);

function evaluate(candidate: typeof ridge) {
  const adjustedTip = baselineTip.map(row => ({
    ...row, probability: logistic(candidate.homeOffset + candidate.slope * logOdds(row.probability)),
  }));
  const adjustedPoints = scored.map(({ points: row, sensitivity, tip }, i) => {
    const mean = tip.probability;
    const delta = adjustedTip[i]!.probability - mean;
    // Keep the paired scoring draws fixed while moving tip draws to the fitted mean.
    const shift = delta < 0 ? delta / mean * sensitivity.low : delta / (1 - mean) * sensitivity.high;
    return { ...row, probability: row.probability + shift / sensitivity.draws };
  });
  const tip = compare(baselineTip, adjustedTip);
  const lowerGain = tip.pairedLogLossGain?.interval95?.[0];
  const pairedGainGate = scored.length >= 600 && lowerGain != null && lowerGain > 0;
  const middle = tip.adjusted.buckets.slice(4, 6);
  const middleBinGate = middle.every(bucket => bucket.absoluteGapPp != null && bucket.absoluteGapPp <= 2);
  return { fit: candidate, tip, teamFirstPoints: compare(points, adjustedPoints), pairedGainGate, middleBinGate,
    meetsTipShipRule: pairedGainGate || middleBinGate };
}

// Each draw's derivative is weighted toward the boundary reached by the shock.
// The resulting means keep the original scoring and possession-retention draws.
const fivePointTipShock = scored.map(({ sensitivity, tip }) => ({
  up: 5 * sensitivity.high / ((1 - tip.probability) * sensitivity.draws),
  down: 5 * sensitivity.low / (tip.probability * sensitivity.draws),
}));
const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
console.log(JSON.stringify({
  fittedGames: training.length,
  holdoutGames: scored.length,
  rawTip: firstBasketCalibration(training),
  candidate: evaluate(ridge),
  homeOnlyDiagnostic: evaluate(homeOnly),
  fivePointTipShockMeanPp: {
    up: average(fivePointTipShock.map(row => row.up)),
    down: average(fivePointTipShock.map(row => row.down)),
  },
}, null, 2));

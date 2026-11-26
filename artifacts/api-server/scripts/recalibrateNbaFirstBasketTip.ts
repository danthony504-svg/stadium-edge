import { readFile } from "node:fs/promises";
import { firstBasketCalibration, type FirstBasketEvaluationCase } from "../src/lib/nbaFirstBasketBacktest.js";
import { pairedGameLossBootstrap } from "../src/lib/nbaFirstBasketIntervals.js";
import { DEFAULT_FIRST_BASKET_USAGE_PRIOR, openingGameSummary, priceFirstBasket, type OpeningGame } from "../src/lib/nbaFirstBasketModel.js";

type Replay = { history: OpeningGame[]; cases: FirstBasketEvaluationCase[] };
type Row = { probability: number; outcome: number };

const logOdds = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const loss = ({ probability, outcome }: Row) => -Math.log(Math.max(1e-12, outcome ? probability : 1 - probability));

function fit(rows: Row[]) {
  let intercept = 0;
  let slope = 1;
  for (let i = 0; i < 40; i++) {
    let error = 0, weightedError = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const row of rows) {
      const x = logOdds(row.probability);
      const p = logistic(intercept + slope * x);
      const residual = row.outcome - p;
      const weight = p * (1 - p);
      error += residual;
      weightedError += residual * x;
      h00 += weight;
      h01 += weight * x;
      h11 += weight * x * x;
    }
    const determinant = h00 * h11 - h01 * h01;
    if (!(determinant > 0)) throw new Error("Tip fit needs both outcomes and varying forecasts");
    const moveIntercept = (h11 * error - h01 * weightedError) / determinant;
    const moveSlope = (h00 * weightedError - h01 * error) / determinant;
    intercept += moveIntercept;
    slope += moveSlope;
    if (Math.max(Math.abs(moveIntercept), Math.abs(moveSlope)) < 1e-10) {
      const halfWidth = 1.96 * Math.sqrt(h00 / determinant);
      return { intercept, slope, slope95: [slope - halfWidth, slope + halfWidth] };
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
const model = fit(training);
const scored = replay(holdout, true);
const baselineTip = scored.map(row => row.tip);
const adjustedTip = baselineTip.map(row => ({ ...row, probability: logistic(model.intercept + model.slope * logOdds(row.probability)) }));
const points = scored.map(row => row.points);
const adjustedPoints = scored.map(({ points: row, sensitivity, tip }, i) => {
  const mean = tip.probability;
  const delta = adjustedTip[i]!.probability - mean;
  // Move each tip draw toward 0 or 1 by the fraction that reaches the fitted
  // mean. Team-first scoring is affine in first possession, so the paired
  // sensitivities recover its new mean without resampling any other input.
  const shift = delta < 0 ? delta / mean * sensitivity.low : delta / (1 - mean) * sensitivity.high;
  return { ...row, probability: row.probability + shift / sensitivity.draws };
});
console.log(JSON.stringify({
  fitted: { ...model, fitGames: training.length, calibration: firstBasketCalibration(training) },
  holdoutGames: scored.length,
  tip: compare(baselineTip, adjustedTip),
  teamFirstPoints: compare(points, adjustedPoints),
}, null, 2));

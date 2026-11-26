import { fairAmerican, marketKey, type MarketIdentity, type Side } from "./fairOdds.js";
import { gammaDraw, seededRandom, standardNormal } from "./random.js";
import { americanToProb } from "../oddsAltDevig.js";

type Receiver = { id: string; targetShare: number; catchRate: number; yardsPerCatch: number };
type Team = { quarterbackId: string; basePassRate: number; expectedPlays: number; receivers: readonly Receiver[] };
export type NflGameScript = {
  version: string;
  asOf: number;
  inputsAvailableAt: number;
  eventId: string;
  home: Team;
  away: Team;
  expectedHomeMargin: number;
  paceSd: number;
  marginSd: number;
  passRatePerPoint: number;
  targetConcentration: number;
  yardsShape: number;
  seed?: number;
  draws?: number;
};

const supported = ["player_pass_attempts", "player_pass_yds", "player_receptions", "player_reception_yds"];
const bound = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function simulateNflGameScript(input: NflGameScript) {
  const { home, away, draws = 10_000, seed = 1 } = input;
  const teams = [home, away];
  const ranges = [
    [input.expectedHomeMargin, -80, 80], [input.paceSd, 0, 40], [input.marginSd, 0, 50],
    [input.passRatePerPoint, 0, 0.05], [input.targetConcentration, 0.1, 10000],
    [input.yardsShape, 0.05, 100],
  ];
  const ids = teams.flatMap(team => [team.quarterbackId, ...team.receivers.map(r => r.id)]);
  if (!input.version || !input.eventId || !Number.isFinite(input.asOf) ||
      !Number.isFinite(input.inputsAvailableAt) || input.inputsAvailableAt >= input.asOf ||
      !Number.isInteger(draws) || draws < 1_000 || draws > 50_000 ||
      ranges.some(([value, low, high]) => !Number.isFinite(value) || value! < low! || value! > high!) ||
      new Set(ids).size !== ids.length || ids.some(id => !id) || teams.some(team =>
        !(team.expectedPlays >= 25 && team.expectedPlays <= 100) ||
        !(team.basePassRate >= 0.3 && team.basePassRate <= 0.8) ||
        team.receivers.length < 2 || team.receivers.length > 25 ||
        team.receivers.some(r => !(r.targetShare > 0 && r.targetShare < 1) ||
          !(r.catchRate > 0 && r.catchRate <= 1) || !(r.yardsPerCatch > 0 && r.yardsPerCatch <= 100)) ||
        Math.abs(team.receivers.reduce((sum, r) => sum + r.targetShare, 0) - 1) > 1e-8)) {
    throw new RangeError("Invalid or late game-script inputs");
  }

  const stats = new Map<string, Float64Array>();
  const put = (id: string, market: string) => {
    const values = new Float64Array(draws);
    stats.set(JSON.stringify([id, market]), values);
    return values;
  };
  const outputs = teams.map(team => ({
    attempts: put(team.quarterbackId, "player_pass_attempts"),
    passing: put(team.quarterbackId, "player_pass_yds"),
    receivers: team.receivers.map(receiver => ({
      receptions: put(receiver.id, "player_receptions"),
      yards: put(receiver.id, "player_reception_yds"),
    })),
  }));
  const random = seededRandom(seed);
  for (let draw = 0; draw < draws; draw++) {
    const pace = standardNormal(random) * input.paceSd;
    const homeMargin = input.expectedHomeMargin + standardNormal(random) * input.marginSd;
    for (const [i, team] of teams.entries()) {
      const out = outputs[i]!;
      const plays = bound(Math.round(team.expectedPlays + pace), 35, 110);
      const lead = i === 0 ? homeMargin : -homeMargin;
      const passRate = bound(team.basePassRate - input.passRatePerPoint * lead, 0.3, 0.8);
      const weights = team.receivers.map(r => gammaDraw(r.targetShare * input.targetConcentration, random));
      const weightSum = weights.reduce((total, weight) => total + weight, 0);
      const cumulative: number[] = [];
      for (const [j, r] of team.receivers.entries()) {
        const share = weightSum > 0 ? weights[j]! / weightSum : r.targetShare;
        cumulative.push((cumulative.at(-1) ?? 0) + share);
      }
      const catches = team.receivers.map(() => 0);
      for (let play = 0; play < plays; play++) {
        if (random() >= passRate) continue;
        out.attempts[draw]!++;
        const selection = random();
        const found = cumulative.findIndex(weight => selection < weight);
        const receiver = found < 0 ? cumulative.length - 1 : found;
        if (random() < team.receivers[receiver]!.catchRate) catches[receiver]!++;
      }
      for (const [j, receiver] of team.receivers.entries()) {
        const receptions = catches[j]!;
        const yards = receptions > 0
          ? Math.round(gammaDraw(receptions * input.yardsShape, random) * receiver.yardsPerCatch / input.yardsShape)
          : 0;
        out.receivers[j]!.receptions[draw] = receptions;
        out.receivers[j]!.yards[draw] = yards;
        out.passing[draw]! += yards;
      }
    }
  }
  return { modelVersion: input.version, eventId: input.eventId, asOf: input.asOf, draws, stats };
}

/** Align raw sampled stats to the supplied marginal hit rates, preserving shared game draws. */
export function priceNflGameScript(
  simulated: ReturnType<typeof simulateNflGameScript>,
  legs: readonly { market: MarketIdentity; side: Side; probability: number; pushFree: boolean }[],
  offeredAmerican?: number,
) {
  if (legs.length < 2 || legs.length > 15 ||
      (offeredAmerican != null && (!Number.isFinite(offeredAmerican) || Math.abs(offeredAmerican) < 100))) {
    throw new RangeError("Invalid game-script ticket");
  }
  const selected = new Uint8Array(simulated.draws).fill(1);
  const seen = new Set<string>();
  const marginalProbabilities: number[] = [];
  for (const leg of legs) {
    const { market, probability, side } = leg;
    const stat = market.market.replace(/_alternate$/, "");
    const identity = marketKey({ ...market, line: 0 });
    const values = simulated.stats.get(JSON.stringify([market.entityId, stat]));
    if (market.sport !== "nfl" || market.eventId !== simulated.eventId || market.period !== "full_game" ||
        !supported.includes(stat) || !values || seen.has(identity) ||
        leg.pushFree !== true || Number.isInteger(market.line) || !["over", "under"].includes(side) ||
        !(probability > 0 && probability < 1)) throw new RangeError("Unsupported game-script leg");
    seen.add(identity);

    // One reproducible tie order per raw stat, reversed for the Under side.
    const rank = Array.from({ length: simulated.draws }, (_, i) => i);
    rank.sort((a, b) => {
      const order = values[b]! - values[a]! || (Math.imul(a + 1, 0x9e3779b1) >>> 0) - (Math.imul(b + 1, 0x9e3779b1) >>> 0);
      return side === "over" ? order : -order;
    });
    const hits = Math.round(probability * simulated.draws);
    marginalProbabilities.push(hits / simulated.draws);
    for (let index = hits; index < rank.length; index++) selected[rank[index]!] = 0;
  }

  const joint = selected.reduce((sum, hit) => sum + hit, 0) / simulated.draws;
  const independent = marginalProbabilities.reduce((product, p) => product * p, 1);
  const breakEven = offeredAmerican == null ? null : americanToProb(offeredAmerican);
  return {
    engine: "nfl_game_script" as const, modelVersion: simulated.modelVersion,
    joint, independent, marginalProbabilities, fairAmerican: fairAmerican(joint),
    draws: simulated.draws,
    correlationLift: independent > 0 ? joint / independent : null,
    breakEven,
    expectedReturnPerUnit: breakEven == null ? null : joint / breakEven - 1,
  };
}

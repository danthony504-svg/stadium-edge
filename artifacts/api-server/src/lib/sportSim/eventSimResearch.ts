import { cap, normal, playEvent, prepareEvent, rng, type EventSnapshot, type Period, type Ratings } from "./eventKernels.js";
import type { NbaLine } from "./nbaPossessionV3.js";

const GROUPS = 400;
const PER_GROUP = 25;
const RUNS = GROUPS * PER_GROUP;
const mean = (a: Int16Array) => a.reduce((s, x) => s + x, 0) / a.length;
const quantile = (a: readonly number[], q: number) => a[Math.floor((a.length - 1) * q)]!;
const asc = (a: number, b: number) => a - b;

export function simulateEventResearch(snapshot: EventSnapshot, seed = 78431, audit?: (frame: ReturnType<typeof playEvent>) => void) {
  const context = prepareEvent(snapshot);
  const homeScores = new Int16Array(RUNS), awayScores = new Int16Array(RUNS);
  const winner = new Int8Array(RUNS), retired = new Uint8Array(RUNS);
  const ratings: Ratings[] = [];
  const setScores = new Map<string, number>();
  const rateRng = rng(seed);
  const frameAt = (i: number) => playEvent(snapshot, context, ratings[Math.floor(i / PER_GROUP)]!,
    rng((seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0));
  for (let block = 0; block < GROUPS; block++) {
    ratings.push([1 + snapshot.uncertainty * normal(rateRng), 1 + snapshot.uncertainty * normal(rateRng)]);
    for (let run = 0; run < PER_GROUP; run++) {
      const i = block * PER_GROUP + run;
      const f = frameAt(i);
      audit?.(f);
      const scores = f.regulation ?? f.teams.map(t => t.score);
      // NHL full-game lines use the shootout adjustment, while player goals
      // and the replay exclude it. Soccer lines are 90-minute settlement.
      homeScores[i] = scores[0]! + Number(f.tiebreak === "shootout" && f.winner === 0);
      awayScores[i] = scores[1]! + Number(f.tiebreak === "shootout" && f.winner === 1);
      winner[i] = f.regulation ? Math.sign(scores[0]! - scores[1]!) : f.winner === 0 ? 1 : f.winner === 1 ? -1 : 0;
      retired[i] = Number(f.retired != null);
      if (snapshot.sport === "tennis" && !retired[i]) {
        const score = `${f.teams[0].totals.sets ?? 0}–${f.teams[1].totals.sets ?? 0}`;
        setScores.set(score, (setScores.get(score) ?? 0) + 1);
      }
    }
  }
  return { snapshot, homeScores, awayScores, winner, retired, frameAt, setScores };
}
type Draws = ReturnType<typeof simulateEventResearch>;

export function researchLine(draws: Draws, q: NbaLine) {
  if ((q.kind === "spread" || q.kind === "ml" || q.kind === "teamTotal") && !q.teamSide) return null;
  if (q.kind !== "ml" && !Number.isFinite(q.line)) return null;
  if ((q.kind === "total" || q.kind === "teamTotal") && !q.totalSide) return null;
  const groups: number[] = [];
  let wins = 0, pushes = 0, voids = 0;
  for (let block = 0; block < GROUPS; block++) {
    let w = 0, available = 0;
    for (let run = 0; run < PER_GROUP; run++) {
      const i = block * PER_GROUP + run;
      if (draws.retired[i]) { voids++; continue; }
      available++;
      const home = draws.homeScores[i]!, away = draws.awayScores[i]!;
      const team = q.teamSide === "home" ? home : away;
      const opposed = q.teamSide === "home" ? away : home;
      const value = q.kind === "ml" ? draws.winner[i]! * (q.teamSide === "home" ? 1 : -1)
        : q.kind === "spread" ? team - opposed + q.line!
        : ((q.kind === "teamTotal" ? team : home + away) - q.line!) * (q.totalSide === "over" ? 1 : -1);
      if (value > 0) w++;
      if (value === 0 && q.kind !== "ml") pushes++;
    }
    wins += w;
    if (available) groups.push(w / available);
  }
  const count = RUNS - voids;
  if (!count || !groups.length) return null;
  const win = wins / count;
  const observed = groups.reduce((s, p) => s + (p - win) ** 2, 0) / groups.length;
  const within = win * (1 - win) / (count / GROUPS);
  const scale = Math.sqrt(observed > 0 ? Math.max(0, observed - within) / observed : 0);
  groups.sort(asc);
  return {
    win, push: pushes / count, void: voids / RUNS,
    ci80: [cap(win + (quantile(groups, .1) - win) * scale, 0, 1), cap(win + (quantile(groups, .9) - win) * scale, 0, 1)],
  };
}

export function summarizeEventResearch(draws: Draws, queries: readonly NbaLine[] = [], retainOutcomes = true) {
  const { winner, homeScores, awayScores } = draws;
  let h = 0, a = 0, ties = 0;
  const picked = [];
  const buckets = new Map<number, number>();
  const size = draws.snapshot.sport === "nfl" ? 5 : 1;
  for (let i = 0; i < RUNS; i++) {
    if (winner[i]! > 0) h++;
    else if (winner[i]! < 0) a++;
    else ties++;
    if (draws.retired[i]) continue;
    const margin = homeScores[i]! - awayScores[i]!;
    const total = homeScores[i]! + awayScores[i]!;
    const bucket = Math.floor(margin / size) * size;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    picked.push({ i, margin, total });
  }
  if (!picked.length) throw new RangeError("No completed game for replay");
  const margins = picked.map(draw => draw.margin).sort(asc);
  const totals = picked.map(draw => draw.total).sort(asc);
  const medianMargin = quantile(margins, .5), medianTotal = quantile(totals, .5);
  const nearest = picked.reduce((best, next) => next.margin === medianMargin &&
    (best.margin !== medianMargin || Math.abs(next.total - medianTotal) < Math.abs(best.total - medianTotal)) ? next : best, picked[0]!);
  const typical = draws.frameAt(nearest.i);
  const lines = Object.fromEntries(queries.flatMap(query => {
    const result = researchLine(draws, query);
    return result ? [[query.id, result]] : [];
  }));
  const home = researchLine(draws, { id: "home", kind: "ml", teamSide: "home" });
  const periods: Period[] = typical.periods;
  return {
    simulations: RUNS, homeWinProbability: h / RUNS, awayWinProbability: a / RUNS, tieProbability: ties / RUNS,
    homeProjectedScore: mean(homeScores), awayProjectedScore: mean(awayScores), confidenceScore: null,
    mostLikelyWinner: h >= a ? "home" : "away", mostLikelyWinnerPct: Math.max(h, a) / RUNS,
    simModel: `${draws.snapshot.sport}-events-v1`, simModelLabel: "Event-level simulator · research",
    coverHitRates: Object.fromEntries(Object.entries(lines).map(([id, r]) => [id, r.win])),
    ...(retainOutcomes ? { outcomes: { homeScores: Array.from(homeScores), awayScores: Array.from(awayScores) } } : {}),
    eventSimulation: {
      homeWinRange80: home?.ci80 ?? null, retirementProbability: 1 - picked.length / RUNS,
      marginRange80: [quantile(margins, .1), quantile(margins, .9)],
      totalRange80: [quantile(totals, .1), quantile(totals, .9)], lines,
      marginHistogram: [...buckets].sort(([a], [b]) => a - b).map(([from, count]) => ({ from, through: from + size - 1, count })),
      ...(draws.setScores.size ? { setScoreRates: [...draws.setScores]
        .sort(([, a], [, b]) => b - a).map(([score, count]) => ({ score, probability: count / picked.length })) } : {}),
      totalHistogram: [...picked.reduce((map, draw) => {
        const bin = Math.floor(draw.total / size) * size;
        return map.set(bin, (map.get(bin) ?? 0) + 1);
      }, new Map<number, number>())].sort(([a], [b]) => a - b)
        .map(([from, count]) => ({ from, through: from + size - 1, count })),
      representative: { periods, percentile: 50, margin: medianMargin, tiebreak: typical.tiebreak,
        winner: typical.winner === 0 ? "home" : typical.winner === 1 ? "away" : null,
        teams: typical.teams.map(team => team.players.map(({ id, name, stats }) => ({ id, name, stats }))),
      },
    },
  };
}

import { normal, rng, type Random } from "./sportSim/eventKernels.js";

export type Side = 0 | 1;
export type Pair<T> = readonly [T, T];
export type Method = "FT" | "2" | "3";
export type Rule = "points" | "field_goal";
export const firstBasketMarkets = ["player_first_basket", "player_first_team_basket", "player_method_of_first_basket"] as const;
export type Market = typeof firstBasketMarkets[number];
export const methods = ["FT", "2", "3"] as const;

export type FirstBasketPlayer = {
  id: string;
  name: string;
  // Season-to-date per-minute opportunity rates for free throws, twos, and threes.
  usage: readonly [number, number, number];
};
export type FirstBasketTeam = { id: string; starters: readonly FirstBasketPlayer[]; jumperId: string };
export type OpenPlay = { playerId: string; method: Method; made: boolean; clock: string };
export type OpeningPossession = { side: Side; shots: readonly OpenPlay[] };
export type OpeningGame = {
  eventId: string;
  finalAt: number;
  availableAt: number;
  teams: Pair<{ id: string; starters: readonly string[]; jumperId: string }>;
  tipWinner: Side;
  firstPossession: Side;
  // Ordered, complete possessions through the opening window.
  possessions: readonly OpeningPossession[];
};
export type BookRule = { book: string; market: Market; rule: Rule };
export type FirstBasketSnapshot = {
  eventId: string;
  startsAt: number;
  availableAt: number;
  source: string;
  oddsEventId?: string;
  home: FirstBasketTeam;
  away: FirstBasketTeam;
  confirmedAt: number | null;
  bookRules?: readonly BookRule[];
};
export type Quote = {
  book: string;
  market: Market;
  playerId: string;
  rule: Rule;
  method?: Method;
  price: number;
  noVig: number | null;
};

const other = (side: Side): Side => side === 0 ? 1 : 0;
const validSide = (side: unknown): side is Side => side === 0 || side === 1;
const TARGET_DRAWS = 400;
const validClock = (clock: string) => /^(?:(?:1[0-2]|[0-9]):[0-5]\d)(?:\.\d+)?$/.test(clock);
const validTime = (value: number) => Number.isFinite(value) && value > 0;
const methodIndex = (method: Method) => methods.indexOf(method);

export function validateFirstBasketSnapshot(game: FirstBasketSnapshot) {
  const { home, away, startsAt, availableAt, confirmedAt } = game;
  return !!game.eventId && !!game.source && validTime(startsAt) && validTime(availableAt) && availableAt < startsAt &&
    (confirmedAt === null || (validTime(confirmedAt) && confirmedAt <= availableAt)) &&
    !!home?.id && !!away?.id && home.id !== away.id && [home, away].every(team =>
      Array.isArray(team.starters) && team.starters.length === 5 &&
      team.starters.some(player => player.id === team.jumperId) &&
      team.starters.every((player: FirstBasketPlayer) => !!player.id && !!player.name && player.usage?.length === 3 &&
        player.usage.every(rate => Number.isFinite(rate) && rate >= 0) && player.usage.some(rate => rate > 0))) &&
    new Set([...home.starters, ...away.starters].map(player => player.id)).size === 10;
}

function firstScore(game: OpeningGame, rule: Rule, side?: Side) {
  for (const possession of game.possessions) {
    if (side != null && side !== possession.side) continue;
    const shot = possession.shots.find(shot => shot.made && (rule === "points" || shot.method !== "FT"));
    if (shot) return { ...shot, side: possession.side, teamId: game.teams[possession.side].id };
  }
  return null;
}

/** Accept only complete source records, including both starting fives and the opening tip. */
export function openingGameSummary(game: OpeningGame) {
  if (!game.eventId || !validTime(game.finalAt) || !validTime(game.availableAt) || game.availableAt < game.finalAt ||
      !validSide(game.tipWinner) || !validSide(game.firstPossession) || game.teams?.length !== 2 ||
      !game.teams.every(team => !!team.id && team.starters?.length === 5 && team.starters.includes(team.jumperId)) ||
      game.teams[0].id === game.teams[1].id || new Set(game.teams.flatMap(team => team.starters)).size !== 10 ||
      !game.possessions?.length || game.possessions[0]!.side !== game.firstPossession ||
      !game.possessions.every(possession => validSide(possession.side) && Array.isArray(possession.shots) &&
        possession.shots.every(shot => !!shot.playerId && typeof shot.made === "boolean" &&
          methods.includes(shot.method) && validClock(shot.clock)))) return null;
  const firstPoints = firstScore(game, "points");
  const firstFieldGoal = firstScore(game, "field_goal");
  if (!firstPoints || !firstFieldGoal) return null;
  return { eventId: game.eventId, teams: game.teams, tipWinner: game.tipWinner, firstPossession: game.firstPossession,
    firstPoints, firstFieldGoal };
}

/** Condition on actual possession, including a lost tip recovered by the other side. */
export function teamScoresFirst(homeRate: number, awayRate: number, homeStarts: number) {
  const denominator = homeRate + awayRate - homeRate * awayRate;
  return denominator > 0 ? homeRate * (homeStarts + (1 - homeStarts) * (1 - awayRate)) / denominator : null;
}

function gamma(shape: number, random: Random): number {
  if (shape < 1) return gamma(shape + 1, random) * random() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(random);
    const base = 1 + c * x;
    if (base <= 0) continue;
    const v = base ** 3;
    if (Math.log(random()) < x * x / 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}
function beta(wins: number, misses: number, random: Random) {
  const a = gamma(wins, random);
  return a / (a + gamma(misses, random));
}
const average = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const implied = (price: number) => price > 0 ? 100 / (100 + price) : -price / (100 - price);
const fairPrice = (p: number) => Math.round(p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);

export function priceFirstBasket(snapshot: FirstBasketSnapshot, records: readonly OpeningGame[], quotes: readonly Quote[], now: number) {
  if (!validateFirstBasketSnapshot(snapshot) || snapshot.availableAt > now) return { status: "waiting_for_starters" } as const;
  if (now >= snapshot.startsAt) return { status: "started" } as const;
  if (snapshot.confirmedAt === null) return { status: "waiting_for_starters" } as const;
  const unique = new Map<string, OpeningGame>();
  const cutoff = Math.min(now, snapshot.availableAt);
  for (const record of records) {
    if (record.eventId === snapshot.eventId || record.availableAt > cutoff || !openingGameSummary(record)) continue;
    if ((unique.get(record.eventId)?.availableAt ?? 0) < record.availableAt) unique.set(record.eventId, record);
  }
  const history = [...unique.values()].sort((a, b) => b.finalAt - a.finalAt);
  const teams = [snapshot.home, snapshot.away] as const;
  const teamGames = teams.map(team => history.filter(game => game.teams.some(side => side.id === team.id)).slice(0, 30));
  if (teamGames.some(games => !games.length)) return { status: "insufficient_history" } as const;

  const jumpers = teams.map(team => team.jumperId);
  let tipWins = 10, tipLosses = 10, retained = 18, lost = 2;
  for (const game of history) {
    const winner = game.teams[game.tipWinner].jumperId;
    const loser = game.teams[other(game.tipWinner)].jumperId;
    const containsHome = winner === jumpers[0] || loser === jumpers[0];
    const containsAway = winner === jumpers[1] || loser === jumpers[1];
    const weight = containsHome && containsAway ? 2 : .5;
    if ((containsHome && winner === jumpers[0]) || (containsAway && loser === jumpers[1])) tipWins += weight;
    else if (containsHome || containsAway) tipLosses += weight;
    if (game.tipWinner === game.firstPossession) retained++;
    else lost++;
  }

  const stats = teams.map((team, i) => {
    const shots = new Map<string, number[]>();
    const made = [0, 0, 0];
    let total = 0, points = 0, fieldGoals = 0;
    for (const game of teamGames[i]!) {
      const side = game.teams[0].id === team.id ? 0 : 1;
      for (const possession of game.possessions) {
        if (possession.side !== side) continue;
        total++;
        points += Number(possession.shots.some(shot => shot.made));
        fieldGoals += Number(possession.shots.some(shot => shot.made && shot.method !== "FT"));
        for (const shot of possession.shots) {
          const j = methodIndex(shot.method);
          const counts = shots.get(shot.playerId) ?? [0, 0, 0];
          counts[j]!++;
          shots.set(shot.playerId, counts);
          made[j]! += Number(shot.made);
        }
      }
    }
    return { total, points, fieldGoals, shots, made };
  });
  const random = rng([...snapshot.eventId].reduce((seed, char) => Math.imul(seed ^ char.charCodeAt(0), 16777619), 2166136261));
  const tips: number[] = [], starts: number[] = [];
  const first = { points: [] as number[], field_goal: [] as number[] };
  const samples = new Map<string, number[]>();
  const keyOf = (rule: Rule, market: Market, playerId: string, method?: Method) =>
    JSON.stringify([rule, market, playerId, method]);
  const record = (key: string, value: number) => {
    const values = samples.get(key) ?? [];
    values.push(value);
    samples.set(key, values);
  };
  for (let draw = 0; draw < TARGET_DRAWS; draw++) {
    const tip = beta(tipWins, tipLosses, random);
    const keepsBall = beta(retained, lost, random);
    const homeStarts = tip * keepsBall + (1 - tip) * (1 - keepsBall);
    tips.push(tip);
    starts.push(homeStarts);
    const masses = teams.map((team, i) => methods.map((_, j) => {
      const stat = stats[i]!;
      const weights = team.starters.map(player => gamma(.25 + player.usage[j]! * 35 + (stat.shots.get(player.id)?.[j] ?? 0), random));
      const denominator = weights.reduce((sum, weight) => sum + weight, 0);
      const methodMass = gamma([3, 12, 6][j]! + stat.made[j]!, random);
      return weights.map(weight => methodMass * weight / denominator);
    }));
    for (const rule of ["points", "field_goal"] as const) {
      const rates = stats.map(stat => {
        const scoring = rule === "points" ? stat.points : stat.fieldGoals;
        return beta(scoring + (rule === "points" ? 6 : 5), stat.total - scoring + 6, random);
      });
      const homeFirst = teamScoresFirst(rates[0]!, rates[1]!, homeStarts)!;
      first[rule].push(homeFirst);
      for (const side of [0, 1] as const) {
        const mass = masses[side]!;
        const eligible = rule === "points" ? mass : mass.slice(1);
        const denominator = eligible.flat().reduce((sum, weight) => sum + weight, 0);
        const teamFirst = side === 0 ? homeFirst : 1 - homeFirst;
        teams[side].starters.forEach((player, j) => {
          const share = eligible.reduce((sum, list) => sum + list[j]!, 0) / denominator;
          record(keyOf(rule, "player_first_basket", player.id), share * teamFirst);
          record(keyOf(rule, "player_first_team_basket", player.id), share);
          methods.forEach((method, k) => record(keyOf(rule, "player_method_of_first_basket", player.id, method),
            method === "FT" && rule === "field_goal" ? 0 : mass[k]![j]! / denominator * teamFirst));
        });
      }
    }
  }

  const players = new Map(teams.flatMap(team =>
    team.starters.map(player => [player.id, { name: player.name, teamId: team.id }] as const)));
  const thinHistory = teamGames.some(games => games.length < 5);
  const rows = quotes.flatMap(quote => {
    const values = samples.get(keyOf(quote.rule, quote.market, quote.playerId, quote.method));
    const player = players.get(quote.playerId);
    if (!values || !player || !Number.isFinite(quote.price) || Math.abs(quote.price) < 100) return [];
    const probability = average(values);
    if (probability <= 0 || probability >= 1) return [];
    const breakEven = implied(quote.price);
    const positiveEvProbability = values.filter(p => p > breakEven).length / values.length;
    const confidence = thinHistory ? "Low" : positiveEvProbability >= .9 ? "High" : positiveEvProbability >= .7 ? "Medium" : "Low";
    const grade = probability <= breakEven ? "Pass" : confidence === "High" ? "Strong Bet" : confidence === "Medium" ? "Small Edge" : "Lean";
    return [{ ...quote, player: player.name, teamId: player.teamId, probability, breakEven, fairPrice: fairPrice(probability), positiveEvProbability, confidence, grade }];
  });
  const top = (rule: Rule, market: Market) => {
    const ranked = rows.filter(row => row.rule === rule && row.market === market)
      .sort((a, b) => b.positiveEvProbability - a.positiveEvProbability ||
        b.probability - b.breakEven - (a.probability - a.breakEven));
    const seen = new Set<string>();
    return ranked.filter(row => {
      if (seen.has(row.playerId)) return false;
      seen.add(row.playerId);
      return true;
    }).slice(0, 3);
  };
  return { status: "ready", confirmedAt: snapshot.confirmedAt, source: snapshot.source,
    homeTipWin: average(tips), homeFirstPossession: average(starts), tipWinnerKeepsBall: retained / (retained + lost),
    openingRate: stats.map(stat => (stat.points + 6) / (stat.total + 12)),
    openingUsage: teams.map((team, side) => Object.fromEntries(team.starters.map(player => [
      player.id, player.usage.reduce((sum, value, j) =>
        sum + .25 + value * 35 + (stats[side]!.shots.get(player.id)?.[j] ?? 0), 0),
    ]))),
    homeScoresFirst: { points: average(first.points), field_goal: average(first.field_goal) },
    historyGames: new Set(teamGames.flat().map(game => game.eventId)).size,
    groups: (["points", "field_goal"] as const).flatMap(rule => firstBasketMarkets.map(market => ({ rule, market, rows: top(rule, market) }))),
  } as const;
}

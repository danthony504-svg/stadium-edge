/** Snapshot-only NBA possession simulation. No live data or client requests inside a draw. */
export const NBA_POSSESSION_VERSION = "nba-possession-v3";
const RATING_DRAWS = 400;
const GAMES_PER_RATING = 25;
const DRAWS = RATING_DRAWS * GAMES_PER_RATING;
export type NbaPlayer = {
  id: string; name: string; starter: boolean; minutes: number; minutesLimit?: number;
  // Per-minute roles, supplied from the pregame depth chart and peer data.
  role: readonly [shots: number, assists: number, rebounds: number];
  history?: readonly { eventId: string; finalAt: number; availableAt: number; minutes: number; shots: number; assists: number; rebounds: number }[];
};
type Team = {
  id: string; lineupSource: string; lineupConfirmedAt: number;
  rotationChanges?: readonly { unavailableId: string; replacementId: string; minutes: number }[];
  offense: number; defense: number; ratingGames: number; pace: number; restDays: number;
  turnoverRate: number; shotMix: readonly [number, number, number]; makeRate: readonly [number, number, number];
  offensiveReboundRate: number; freeThrowTripRate: number; freeThrowPct: number;
  players: readonly NbaPlayer[];
};
export type NbaPregame = {
  eventId: string; startsAt: number; availableAt: number; leagueRating: number; leaguePace: number;
  homeCourtPoints: number; ratingSd: number; home: Team; away: Team;
  market?: { fairHomeMargin: number; fairTotal: number; availableAt: number };
};
type Side = "home" | "away";
export type NbaLine = { id: string; kind: "ml" | "spread" | "total" | "teamTotal"; teamSide?: Side; totalSide?: "over" | "under"; line?: number };
type Ratings = { pace: number; home: number; away: number };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const finite = (x: number, low: number, high: number) => Number.isFinite(x) && x >= low && x <= high;

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) + 0.5) / 4294967296;
  };
}
function normal(next: () => number) { return Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next()); }

function applyRotationChanges(team: Team): Team {
  if (!team.rotationChanges?.length) return team;
  const players = team.players.map(player => ({ ...player }));
  const byId = new Map(players.map(player => [player.id, player]));
  const unavailable = new Set(team.rotationChanges.map(change => change.unavailableId));
  for (const { unavailableId, replacementId, minutes } of team.rotationChanges) {
    const from = byId.get(unavailableId), to = byId.get(replacementId);
    if (!from || !to || unavailable.has(replacementId) || !finite(minutes, 0.01, from.minutes)) {
      throw new RangeError("Invalid injury minutes transfer");
    }
    from.minutes -= minutes;
    to.minutes += minutes;
  }
  if (players.some(player => unavailable.has(player.id) && player.minutes > 0.01)) {
    throw new RangeError("All unavailable-player minutes must be assigned to replacements");
  }
  for (const player of players) if (unavailable.has(player.id)) player.minutes = 0;
  return { ...team, players };
}

function validate(input: NbaPregame) {
  const { home, away, availableAt, startsAt, market } = input;
  if (!input.eventId || !Number.isFinite(availableAt) || !Number.isFinite(startsAt) || availableAt >= startsAt ||
      !finite(input.leagueRating, 95, 135) || !finite(input.leaguePace, 80, 120) ||
      !finite(input.homeCourtPoints, 0, 8) || !finite(input.ratingSd, 0.1, 20) || home.id === away.id ||
      (market && (!finite(market.fairHomeMargin, -35, 35) || !finite(market.fairTotal, 155, 305) ||
        !Number.isFinite(market.availableAt) || market.availableAt > availableAt))) throw new RangeError("Invalid NBA pregame snapshot");
  const ids = new Set<string>();
  for (const team of [home, away]) {
    if (!team.id || !team.lineupSource || !Number.isFinite(team.lineupConfirmedAt) ||
        team.lineupConfirmedAt > availableAt || !finite(team.offense, 70, 155) || !finite(team.defense, 70, 155) ||
        !finite(team.ratingGames, 0, 200) || !finite(team.pace, 70, 135) || !finite(team.restDays, 0, 30) ||
        !finite(team.turnoverRate, 0.02, 0.35) || !finite(team.offensiveReboundRate, 0.05, 0.5) ||
        !finite(team.freeThrowTripRate, 0.01, 0.35) || !finite(team.freeThrowPct, 0.4, 0.98) ||
        team.shotMix.length !== 3 || team.makeRate.length !== 3 ||
        !team.shotMix.every(x => finite(x, 0, 1)) || Math.abs(team.shotMix.reduce((sum, x) => sum + x, 0) - 1) > 1e-8 ||
        !team.makeRate.every(x => finite(x, 0.1, 0.9)) || team.players.length > 18 ||
        team.players.filter(p => p.starter).length !== 5 ||
        team.players.filter(p => p.minutesLimit == null && p.minutes > 0).length < 5 ||
        Math.abs(team.players.reduce((sum, p) => sum + p.minutes, 0) - 240) > 0.01) throw new RangeError("Invalid team ratings or rotation");
    for (const p of team.players) {
      if (!p.id || !p.name || ids.has(p.id) || !finite(p.minutes, 0, 48) || (p.starter && p.minutes <= 0) ||
          (p.minutesLimit != null && (!Number.isInteger(p.minutesLimit) || !finite(p.minutesLimit, p.minutes, 48))) ||
          p.role.length !== 3 || !p.role.every(x => finite(x, 0.001, 4))) throw new RangeError("Invalid player role or minutes");
      ids.add(p.id);
    }
  }
}

function roleRates(p: NbaPlayer, cutoff: number, eventId: string): number[] {
  const dated = (p.history ?? []).filter(g => g.eventId && g.eventId !== eventId &&
    Number.isFinite(g.finalAt) && Number.isFinite(g.availableAt) && g.finalAt <= g.availableAt && g.availableAt < cutoff &&
    finite(g.minutes, 1, 65) && [g.shots, g.assists, g.rebounds].every(x => finite(x, 0, 75)))
    .sort((a, b) => b.finalAt - a.finalAt || b.availableAt - a.availableAt);
  const games = [...new Map(dated.reverse().map(game => [game.eventId, game])).values()].reverse().slice(0, 20);
  const totals = p.role.map(rate => rate * 240);
  let exposure = 240;
  games.forEach((g, i) => {
    const weight = 0.5 ** (i / 6);
    exposure += g.minutes * weight;
    totals[0]! += g.shots * weight;
    totals[1]! += g.assists * weight;
    totals[2]! += g.rebounds * weight;
  });
  return totals.map(n => n / exposure);
}

function targetRatings(input: NbaPregame): Ratings {
  const { home, away, leagueRating, leaguePace, ratingSd, market } = input;
  const shrink = (value: number, games: number, prior: number) => prior + (value - prior) * games / (games + 18);
  const pace = (shrink(home.pace, home.ratingGames, leaguePace) + shrink(away.pace, away.ratingGames, leaguePace)) / 2;
  const rest = (days: number) => days <= 1 ? -1.5 : 0;
  const h = shrink(home.offense, home.ratingGames, leagueRating) + shrink(away.defense, away.ratingGames, leagueRating) - leagueRating +
    (input.homeCourtPoints / 2 + rest(home.restDays)) * 100 / pace;
  const a = shrink(away.offense, away.ratingGames, leagueRating) + shrink(home.defense, home.ratingGames, leagueRating) - leagueRating +
    (-input.homeCourtPoints / 2 + rest(away.restDays)) * 100 / pace;
  const marketWeight = market ? clamp(ratingSd / (ratingSd + 8), 0.15, 0.75) : 0;
  return { pace,
    home: h * (1 - marketWeight) + (market ? (market.fairTotal + market.fairHomeMargin) * 50 / pace * marketWeight : 0),
    away: a * (1 - marketWeight) + (market ? (market.fairTotal - market.fairHomeMargin) * 50 / pace * marketWeight : 0),
  };
}

function calibratedMakes(team: Team, rating: number) {
  const made = (i: number, shift: number) => clamp(team.makeRate[i]! + shift, 0.06, 0.96);
  let low = -0.5, high = 0.5;
  for (let i = 0; i < 14; i++) {
    const shift = (low + high) / 2;
    let fgPoints = 0, miss = 0;
    for (let type = 0; type < 3; type++) {
      fgPoints += team.shotMix[type]! * made(type, shift) * (type === 2 ? 3 : 2);
      miss += team.shotMix[type]! * (1 - made(type, shift));
    }
    const liveRebound = (1 - team.freeThrowTripRate) * miss + team.freeThrowTripRate * (1 - team.freeThrowPct);
    const repeat = liveRebound * team.offensiveReboundRate;
    const base = 2 * team.freeThrowTripRate * team.freeThrowPct + (1 - team.freeThrowTripRate) * fgPoints;
    const ppp = base * (1 - team.turnoverRate) / (1 - repeat * (1 - team.turnoverRate));
    if (ppp * 100 < rating) low = shift;
    else high = shift;
  }
  return team.makeRate.map((_, i) => made(i, (low + high) / 2));
}

const Stat = { minutes: 0, points: 1, shots: 2, assists: 3, rebounds: 4, fouls: 5 } as const;
const STRIDE = 6;
type GamePlayer = { source: NbaPlayer; rates: number[]; offset: number };
type GameTeam = { source: Team; players: GamePlayer[]; box: Uint16Array; lineup: GamePlayer[]; points: number; makes: number[] };

function takeLineup(team: GameTeam, minute: number, blowout: boolean) {
  const eligible = team.players.filter(p => p.source.minutes > 0 && team.box[p.offset + Stat.minutes]! < (p.source.minutesLimit ?? 100));
  const foulSafe = eligible.filter(p => team.box[p.offset + Stat.fouls]! < 6);
  const pool = foulSafe.length >= 5 ? foulSafe : eligible;
  if (pool.length < 5) throw new RangeError("Rotation ran out of available players");
  const rank = (p: GamePlayer) => {
    const fouls = team.box[p.offset + Stat.fouls]!;
    return p.source.minutes * Math.min(1.25, (minute + 1) / 48) - team.box[p.offset + Stat.minutes]! +
      (p.source.starter && minute === 0 ? 20 : 0) -
      (blowout && p.source.starter ? 7 : 0) -
      (fouls >= 6 ? 50 : minute < 36 && fouls >= (minute < 24 ? 3 : 5) ? 4 : 0);
  };
  pool.sort((a, b) => rank(b) - rank(a));
  team.lineup = pool.slice(0, 5);
  for (const p of team.lineup) team.box[p.offset + Stat.minutes]!++;
}

function pick(team: GameTeam, index: number, next: () => number, exclude?: GamePlayer) {
  let total = 0;
  for (const p of team.lineup) if (p !== exclude) total += p.rates[index]!;
  let needle = next() * total;
  for (const p of team.lineup) {
    if (p === exclude) continue;
    needle -= p.rates[index]!;
    if (needle < 0) return p;
  }
  return team.lineup.find(p => p !== exclude)!;
}

function possession(off: GameTeam, def: GameTeam, next: () => number) {
  const team = off.source;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (next() < team.turnoverRate) return;
    const shooter = pick(off, 0, next);
    const value = next();
    const type = value < team.shotMix[0] ? 0 : value < team.shotMix[0] + team.shotMix[1] ? 1 : 2;
    if (next() < team.freeThrowTripRate) {
      const defender = def.lineup[Math.floor(next() * 5)]!;
      def.box[defender.offset + Stat.fouls]!++;
      const first = next() < team.freeThrowPct, second = next() < team.freeThrowPct;
      const points = Number(first) + Number(second);
      off.points += points;
      off.box[shooter.offset + Stat.points]! += points;
      if (second) return;
    } else {
      off.box[shooter.offset + Stat.shots]!++;
      if (next() < off.makes[type]!) {
        const points = type === 2 ? 3 : 2;
        off.points += points;
        off.box[shooter.offset + Stat.points]! += points;
        if (next() < (type === 2 ? 0.80 : 0.52)) off.box[pick(off, 1, next, shooter).offset + Stat.assists]!++;
        return;
      }
    }
    const offensive = next() < team.offensiveReboundRate;
    const reboundTeam = offensive ? off : def;
    reboundTeam.box[pick(reboundTeam, 2, next).offset + Stat.rebounds]!++;
    if (!offensive) return;
  }
}

export function simulateNbaPossessions(snapshot: NbaPregame, seed = 32187) {
  const input = { ...snapshot, home: applyRotationChanges(snapshot.home), away: applyRotationChanges(snapshot.away) };
  validate(input);
  const targets = targetRatings(input);
  const rates = [input.home, input.away].map(team => team.players.map(player => roleRates(player, input.availableAt, input.eventId)));
  const homeScores = new Int16Array(DRAWS), awayScores = new Int16Array(DRAWS);
  const homeBoxes = new Uint16Array(DRAWS * input.home.players.length * STRIDE);
  const awayBoxes = new Uint16Array(DRAWS * input.away.players.length * STRIDE);
  const ratingRandom = rng(seed);
  const periods: { home: number; away: number }[][] = [];
  for (let block = 0; block < RATING_DRAWS; block++) {
    const homeMakes = calibratedMakes(input.home, targets.home + normal(ratingRandom) * input.ratingSd);
    const awayMakes = calibratedMakes(input.away, targets.away + normal(ratingRandom) * input.ratingSd);
    const paceRating = targets.pace + normal(ratingRandom) * 1.8;
    for (let i = 0; i < GAMES_PER_RATING; i++) {
      const draw = block * GAMES_PER_RATING + i;
      const next = rng((seed + Math.imul(draw + 1, 0x9e3779b9)) >>> 0);
      const makeTeam = (source: Team, index: number, boxes: Uint16Array, makes: number[]): GameTeam => {
        const size = source.players.length * STRIDE;
        return { source, box: boxes.subarray(draw * size, (draw + 1) * size), lineup: [], points: 0, makes,
          players: source.players.map((p, k) => ({ source: p, offset: k * STRIDE,
            rates: rates[index]![k]!.map(rate => rate * (0.86 + 0.28 * next())) })) };
      };
      const home = makeTeam(input.home, 0, homeBoxes, homeMakes);
      const away = makeTeam(input.away, 1, awayBoxes, awayMakes);
      const pace = clamp(Math.round(paceRating + normal(next) * 4), 75, 125);
      const gamePeriods = [];
      let minute = 0;
      let previousHome = 0, previousAway = 0;
      for (let period = 0; period < 4 || home.points === away.points; period++) {
        if (period >= 20) throw new Error("NBA overtime simulation did not resolve");
        const duration = period < 4 ? 12 : 5;
        const count = period < 4 ? Math.floor(pace * (period + 1) / 4) - Math.floor(pace * period / 4) : Math.round(pace * 5 / 48);
        for (let tick = 0; tick < duration; tick++, minute++) {
          const blowout = minute >= 39 && minute < 48 && Math.abs(home.points - away.points) >= 20;
          takeLineup(home, minute, blowout);
          takeLineup(away, minute, blowout);
          const n = Math.floor(count * (tick + 1) / duration) - Math.floor(count * tick / duration);
          for (let p = 0; p < n; p++) {
            possession(home, away, next);
            possession(away, home, next);
          }
        }
        gamePeriods.push({ home: home.points - previousHome, away: away.points - previousAway });
        previousHome = home.points;
        previousAway = away.points;
      }
      homeScores[draw] = home.points;
      awayScores[draw] = away.points;
      periods.push(gamePeriods);
    }
  }
  return { input, targets, homeScores, awayScores, homeBoxes, awayBoxes, periods };
}

export type NbaDraws = ReturnType<typeof simulateNbaPossessions>;

export function nbaDrawBox(draws: NbaDraws, side: Side, index: number) {
  const team = draws.input[side];
  const data = side === "home" ? draws.homeBoxes : draws.awayBoxes;
  return team.players.map((p, i) => {
    const off = (index * team.players.length + i) * STRIDE;
    return { id: p.id, name: p.name, minutes: data[off]!, points: data[off + 1]!, shots: data[off + 2]!,
      assists: data[off + 3]!, rebounds: data[off + 4]!, fouls: data[off + 5]! };
  });
}

function decision(query: NbaLine, home: number, away: number) {
  const score = query.teamSide === "home" ? home : away;
  const opp = query.teamSide === "home" ? away : home;
  if (query.kind === "ml") return score - opp;
  if (query.kind === "spread") return score - opp + query.line!;
  const total = query.kind === "teamTotal" ? score : home + away;
  return (total - query.line!) * (query.totalSide === "over" ? 1 : -1);
}

/** Scores a prop alone and alongside a game line using the identical player/game draws. */
export function nbaPlayerProp(draws: NbaDraws, prop: {
  athleteId: string; teamSide: Side; stat: "points" | "assists" | "rebounds"; line: number; side: "over" | "under";
}, gameLine?: NbaLine) {
  if (!(prop.teamSide === "home" || prop.teamSide === "away") ||
      !["points", "assists", "rebounds"].includes(prop.stat) || !Number.isFinite(prop.line) ||
      !["over", "under"].includes(prop.side) || (gameLine && !nbaLineProbability(draws, gameLine))) return null;
  const team = draws.input[prop.teamSide];
  const playerIndex = team.players.findIndex(player => player.id === prop.athleteId && player.minutes > 0);
  if (playerIndex < 0) return null;
  const box = prop.teamSide === "home" ? draws.homeBoxes : draws.awayBoxes;
  let wins = 0, pushes = 0, jointWins = 0, lineWins = 0;
  for (let i = 0; i < DRAWS; i++) {
    const stat = box[(i * team.players.length + playerIndex) * STRIDE + Stat[prop.stat]]!;
    const value = (stat - prop.line) * (prop.side === "over" ? 1 : -1);
    if (value > 0) wins++;
    if (value === 0) pushes++;
    if (gameLine && decision(gameLine, draws.homeScores[i]!, draws.awayScores[i]!) > 0) {
      lineWins++;
      if (value > 0) jointWins++;
    }
  }
  return { win: wins / DRAWS, push: pushes / DRAWS,
    jointWin: gameLine ? jointWins / DRAWS : null,
    winGivenGameLineHit: lineWins > 0 ? jointWins / lineWins : null,
  };
}

function percentile(sorted: readonly number[], p: number) {
  return sorted[Math.floor((sorted.length - 1) * p)]!;
}

export function nbaLineProbability(draws: NbaDraws, query: NbaLine) {
  if (!query.id || !["ml", "spread", "total", "teamTotal"].includes(query.kind) ||
      (query.kind !== "total" && !["home", "away"].includes(query.teamSide ?? "")) ||
      (query.kind !== "ml" && !Number.isFinite(query.line)) ||
      ((query.kind === "total" || query.kind === "teamTotal") && !["over", "under"].includes(query.totalSide ?? ""))) return null;
  let wins = 0, pushes = 0;
  const groupRates = [];
  for (let block = 0; block < RATING_DRAWS; block++) {
    let winsInBlock = 0;
    for (let i = 0; i < GAMES_PER_RATING; i++) {
      const index = block * GAMES_PER_RATING + i;
      const value = decision(query, draws.homeScores[index]!, draws.awayScores[index]!);
      if (value > 0) winsInBlock++;
      if (value === 0) pushes++;
    }
    wins += winsInBlock;
    groupRates.push(winsInBlock / GAMES_PER_RATING);
  }
  const win = wins / DRAWS;
  const groupVariance = groupRates.reduce((sum, rate) => sum + (rate - win) ** 2, 0) / (RATING_DRAWS - 1);
  // Correct group-rate variance for finite games per rating. The resulting range is exploratory.
  const between = Math.max(0, (groupVariance - win * (1 - win) / GAMES_PER_RATING) / (1 - 1 / GAMES_PER_RATING));
  const factor = groupVariance > 0 ? Math.sqrt(between / groupVariance) : 0;
  const sorted = groupRates.sort((a, b) => a - b);
  return { win, push: pushes / DRAWS, ci80: [
    clamp(win + (percentile(sorted, 0.1) - win) * factor, 0, 1),
    clamp(win + (percentile(sorted, 0.9) - win) * factor, 0, 1),
  ] };
}

export function summarizeNbaDraws(draws: NbaDraws, queries: readonly NbaLine[] = [], retainOutcomes = true) {
  const margins = Array.from(draws.homeScores, (score, i) => score - draws.awayScores[i]!);
  const sorted = [...margins].sort((a, b) => a - b);
  const mid = percentile(sorted, 0.5);
  const totals = Array.from(draws.homeScores, (score, i) => score + draws.awayScores[i]!).sort((a, b) => a - b);
  const totalMid = percentile(totals, 0.5);
  let representative = -1, nearestTotal = Infinity;
  const buckets = new Map<number, number>();
  for (let i = 0; i < DRAWS; i++) {
    const margin = margins[i]!;
    const bucket = Math.floor(margin / 5) * 5;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    const totalDistance = Math.abs(draws.homeScores[i]! + draws.awayScores[i]! - totalMid);
    if (margin === mid && totalDistance < nearestTotal) {
      representative = i;
      nearestTotal = totalDistance;
    }
  }
  const lines = Object.fromEntries(queries.flatMap(query => {
    const result = nbaLineProbability(draws, query);
    return result ? [[query.id, result]] : [];
  }));
  const homeWin = nbaLineProbability(draws, { id: "home", kind: "ml", teamSide: "home" })!;
  const awayWin = 1 - homeWin.win;
  const mean = (scores: Int16Array) => scores.reduce((sum, score) => sum + score, 0) / DRAWS;
  return {
    simulations: DRAWS, homeWinProbability: homeWin.win, awayWinProbability: awayWin, tieProbability: 0,
    homeProjectedScore: mean(draws.homeScores), awayProjectedScore: mean(draws.awayScores),
    mostLikelyWinner: homeWin.win >= awayWin ? "home" : "away",
    mostLikelyWinnerPct: Math.max(homeWin.win, awayWin), confidenceScore: null,
    simModel: NBA_POSSESSION_VERSION, simModelLabel: "NBA possession simulation · research",
    coverHitRates: Object.fromEntries(Object.entries(lines).map(([id, result]) => [id, result.win])),
    ...(retainOutcomes ? { outcomes: { homeScores: Array.from(draws.homeScores), awayScores: Array.from(draws.awayScores) } } : {}),
    nbaPossessions: {
      ratingDraws: RATING_DRAWS, gamesPerRating: GAMES_PER_RATING,
      homeWinRange80: homeWin.ci80, marginRange80: [percentile(sorted, 0.1), percentile(sorted, 0.9)],
      totalRange80: [percentile(totals, 0.1), percentile(totals, 0.9)], lines,
      marginHistogram: [...buckets].sort(([a], [b]) => a - b).map(([from, count]) => ({ from, through: from + 4, count })),
      marketHomeMargin: draws.input.market?.fairHomeMargin ?? null,
      representative: {
        margin: mid, percentile: 50, periods: draws.periods[representative]!,
        home: nbaDrawBox(draws, "home", representative), away: nbaDrawBox(draws, "away", representative),
      },
    },
  };
}

/** Review kernels. A shared event draw generates scores, periods, and player attribution. */
export type Sport = "nfl" | "mlb" | "nhl" | "soccer" | "tennis";
type Side = 0 | 1;
const sides = [0, 1] as const;
export type Random = () => number;
export const cap = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const normal = (random: Random) => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
export function rng(seed: number): Random {
  let n = seed >>> 0 || 1;
  return () => {
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    return ((n >>> 0) + 0.5) / 4294967296;
  };
}

export type Athlete = { id: string; name: string; role: string; share: number; recentShare?: number; recentGames?: number;
  available?: boolean; replacementId?: string; hand?: "L" | "R" | "S"; redZoneShare?: number; hitFactor?: number; strikeoutFactor?: number };
export type Roster = { id: string; players: Athlete[]; restDays: number; travelKm?: number };
type SnapshotBase = {
  eventId: string; availableAt: number; startsAt: number; resourceVersion: string;
  lineupSource: string; lineupAvailableAt: number; home: Roster; away: Roster;
  uncertainty: number; venueAdvantage?: number;
  anchor?: { availableAt: number; fairMargin: number; fairTotal: number; modelHome: number; modelAway: number };
};
type Nfl = { sport: "nfl"; rules: {
  passRate: number; completion: number; yardsPerCatch: number; runYards: number;
  sackRate: number; giveawayRate: number; kickAccuracy: number; windMph: number; wet: boolean;
} };
type Mlb = { sport: "mlb"; rules: {
  outcomes: [number, number, number, number, number, number, number, number]; // K, BB, HBP, 1B, 2B, 3B, HR, other out
  pitchLimit: number; parkFactor: number; windOutMph: number; automaticRunner: boolean;
} };
type Nhl = { sport: "nhl"; rules: {
  shotsPer60: [number, number]; xgPerShot: number; powerPlayXg: number;
  goalieSave: [number, number]; goalieShots: [number, number]; tourSave: number; playoffs: boolean;
} };
type Soccer = { sport: "soccer"; rules: {
  xg: [number, number]; shots: [number, number]; redRate: number; knockout: boolean;
  lowScoreAdjustment: number;
} };
type Tennis = { sport: "tennis"; rules: {
  surface: "hard" | "clay" | "grass"; bestOf: 3 | 5; decidingTiebreak: 7 | 10 | null;
  serve: [number, number]; serveSample: [number, number]; tourServe: number; ace: [number, number];
  doubleFault: [number, number]; retirement: [number, number];
} };
export type EventSnapshot = SnapshotBase & (Nfl | Mlb | Nhl | Soccer | Tennis);
type Stat = "points" | "passYards" | "recYards" | "rushYards" | "targets" | "td" | "runs" |
  "hits" | "strikeouts" | "pitcherK" | "pa" | "goals" | "shots" | "onTarget" | "assists" |
  "servePoints" | "aces" | "doubleFaults" | "games" | "sets";
export type Period = { label: string; home: number; away: number };
type Player = Athlete & { weight: number; stats: Partial<Record<Stat, number>> };
type Team = { players: Player[]; score: number; totals: Partial<Record<Stat, number>> };
type Frame = { teams: [Team, Team]; periods: Period[]; winner?: Side; retired?: Side; tiebreak?: "shootout" | "penalties"; regulation?: [number, number] };
export type Ratings = [number, number];
const other = (s: Side): Side => s === 0 ? 1 : 0;

const validProbability = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
function role(team: Team, ...roles: string[]) { return team.players.filter(p => roles.includes(p.role)); }
function prepared(roster: Roster) {
  const players = roster.players.map(p => {
    const n = p.recentGames ?? 0;
    return { ...p, weight: ((p.recentShare ?? p.share) * n + p.share * 12) / (n + 12), stats: {} };
  });
  for (const p of players) {
    if (p.available !== false) continue;
    const replacement = players.find(x => x.id === p.replacementId && x.available !== false && x.role === p.role);
    if (p.weight > 0 && !replacement) throw new RangeError("Missing position-compatible injury replacement");
    if (replacement) replacement.weight += p.weight;
    p.weight = 0;
  }
  return players.filter(player => player.available !== false);
}

function sample(players: Player[], random: Random, redZone = false): Player {
  const weight = (p: Player) => redZone ? p.redZoneShare ?? p.weight : p.weight;
  const total = players.reduce((sum, p) => sum + weight(p), 0);
  if (!players.length || !(total > 0)) throw new RangeError("Empty active role");
  let value = random() * total;
  for (const player of players) {
    value -= weight(player);
    if (value < 0) return player;
  }
  return players.at(-1)!;
}
function credit(team: Team, player: Player, stat: Stat, value = 1) {
  team.totals[stat] = (team.totals[stat] ?? 0) + value;
  player.stats[stat] = (player.stats[stat] ?? 0) + value;
}
function record(frame: Frame, label: string, run: () => void) {
  const [h, a] = frame.teams.map(t => t.score);
  run();
  frame.periods.push({ label, home: frame.teams[0].score - h!, away: frame.teams[1].score - a! });
}

export function prepareEvent(snapshot: EventSnapshot) {
  if (!snapshot.eventId || !snapshot.resourceVersion || !snapshot.lineupSource ||
      ![snapshot.availableAt, snapshot.startsAt, snapshot.lineupAvailableAt, snapshot.uncertainty].every(Number.isFinite) ||
      !(snapshot.lineupAvailableAt <= snapshot.availableAt && snapshot.availableAt < snapshot.startsAt) ||
      !(snapshot.uncertainty >= 0.005 && snapshot.uncertainty <= 0.4) ||
      (snapshot.venueAdvantage != null && (!Number.isFinite(snapshot.venueAdvantage) || Math.abs(snapshot.venueAdvantage) > 0.5)) ||
      snapshot.home.id === snapshot.away.id) throw new RangeError("Invalid pregame event snapshot");
  const seen = new Set<string>();
  for (const roster of [snapshot.home, snapshot.away]) {
    if (!roster.id || !Number.isFinite(roster.restDays) || roster.restDays < 0 ||
        (roster.travelKm != null && (!Number.isFinite(roster.travelKm) || roster.travelKm < 0)) ||
        !roster.players.length || roster.players.length > 70) throw new RangeError("Invalid roster");
    for (const p of roster.players) {
      if (!p.id || !p.name || !p.role || seen.has(p.id) || !validProbability(p.share) ||
          [p.hitFactor, p.strikeoutFactor].some(x => x != null && !(x >= .4 && x <= 2.5)) ||
          (p.redZoneShare != null && !(p.redZoneShare > 0 && p.redZoneShare <= 1)) ||
          (p.recentShare != null && !validProbability(p.recentShare)) ||
          (p.recentGames != null && (!Number.isFinite(p.recentGames) || p.recentGames < 0))) throw new RangeError("Invalid athlete role");
      seen.add(p.id);
    }
  }

  const rosters = [prepared(snapshot.home), prepared(snapshot.away)] as const;
  for (const players of rosters) {
    const count = (...roles: string[]) => players.filter(p => roles.includes(p.role) && p.weight > 0).length;
    if ((snapshot.sport === "nfl" && (count("qb") !== 1 || !count("wr", "te", "rb") || !count("rb") || !count("k") || !count("defense"))) ||
        (snapshot.sport === "mlb" && (count("batter") !== 9 || count("starter") !== 1 || !count("reliever", "closer"))) ||
        (snapshot.sport === "nhl" && (!count("skater", "power_play") || count("goalie") !== 1)) ||
        (snapshot.sport === "soccer" && count("outfield", "sub") < 2) ||
        (snapshot.sport === "tennis" && count("server") !== 1)) throw new RangeError("Missing required active roles");
  }
  const r = snapshot.rules;
  if (snapshot.sport === "nfl") {
    const v = snapshot.rules;
    if (![v.passRate, v.completion, v.sackRate, v.giveawayRate, v.kickAccuracy].every(validProbability) ||
        ![v.yardsPerCatch, v.runYards, v.windMph].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) throw new RangeError("Invalid NFL rates");
  } else if (snapshot.sport === "mlb") {
    const v = snapshot.rules;
    if (v.outcomes.length !== 8 || !v.outcomes.every(validProbability) ||
        Math.abs(v.outcomes.reduce((a,b) => a+b,0)-1) > 1e-8 || v.outcomes[0] + v.outcomes[7] < 0.4 ||
        !(v.pitchLimit > 0 && v.pitchLimit <= 150) || !(v.parkFactor >= 0.75 && v.parkFactor <= 1.35) ||
        !Number.isFinite(v.windOutMph)) throw new RangeError("Invalid MLB rates");
  } else if (snapshot.sport === "nhl") {
    const v = snapshot.rules;
    if (![v.xgPerShot, v.powerPlayXg, ...v.goalieSave, v.tourSave].every(validProbability) ||
        !v.shotsPer60.every(n => n > 0 && n < 75) || !v.goalieShots.every(n => Number.isFinite(n) && n >= 0)) throw new RangeError("Invalid NHL rates");
  } else if (snapshot.sport === "soccer") {
    const v = snapshot.rules;
    if (!v.xg.every(n => n > 0 && n < 8) || !v.shots.every(n => n > 0 && n <= 45) || !validProbability(v.redRate) ||
        !(v.lowScoreAdjustment >= 0 && v.lowScoreAdjustment <= .5)) throw new RangeError("Invalid soccer rates");
  } else if (snapshot.sport === "tennis") {
    const v = snapshot.rules;
    if (!["hard", "clay", "grass"].includes(v.surface) || ![3, 5].includes(v.bestOf) ||
        ![7, 10, null].includes(v.decidingTiebreak) ||
        ![...v.serve, ...v.ace, ...v.doubleFault, ...v.retirement, v.tourServe].every(validProbability) ||
        !sides.every(i => v.ace[i] + v.doubleFault[i] <= 1 && v.serveSample[i] >= 0 &&
          Number.isFinite(v.serveSample[i]))) throw new RangeError("Invalid tennis rules or rates");
  } else {
    throw new RangeError("Unknown research sport");
  }
  if (!r) throw new RangeError("Missing sport rules");

  const a = snapshot.anchor;
  if (a && (![a.availableAt, a.fairMargin, a.fairTotal, a.modelHome, a.modelAway].every(Number.isFinite) ||
      a.availableAt > snapshot.availableAt || !(a.modelHome > 0 && a.modelAway > 0 && a.fairTotal > Math.abs(a.fairMargin)))) {
    throw new RangeError("Invalid or late fair-market anchor");
  }
  const weight = a ? cap(snapshot.uncertainty / (snapshot.uncertainty + 0.16), 0.12, 0.72) : 0;
  return { rosters, factors: sides.map(side => {
    const t = side === 0 ? snapshot.home : snapshot.away;
    const market = a ? ((a.fairTotal + (side === 0 ? 1 : -1) * a.fairMargin) / 2) /
      (side === 0 ? a.modelHome : a.modelAway) : 1;
    return cap(1 + weight * (market - 1) + (side === 0 ? 1 : -1) * (snapshot.venueAdvantage ?? 0) -
      (t.restDays <= 1 ? .035 : 0) - Math.min(.04, (t.travelKm ?? 0) / 100000), .55, 1.60);
  }) };
}

export function playEvent(snapshot: EventSnapshot, context: ReturnType<typeof prepareEvent>, rating: Ratings, random: Random): Frame {
  const teams = sides.map(side => ({
    players: context.rosters[side].map(p => ({ ...p, weight: p.weight * (.86 + .28 * random()), stats: {} })),
    score: 0, totals: {},
  })) as [Team, Team];
  const frame: Frame = { teams, periods: [] };
  const strength = sides.map(side => cap(context.factors[side]! * rating[side], .35, 1.90)) as Ratings;
  switch (snapshot.sport) {
    case "nfl": nfl(frame, snapshot.rules, strength, random); break;
    case "mlb": mlb(frame, snapshot.rules, strength, random); break;
    case "nhl": nhl(frame, snapshot.rules, strength, random); break;
    case "soccer": soccer(frame, snapshot.rules, strength, random); break;
    case "tennis": tennis(frame, snapshot.rules, strength, random); break;
  }
  if (frame.winner == null && teams[0].score !== teams[1].score) frame.winner = teams[0].score > teams[1].score ? 0 : 1;
  return frame;
}

function nfl(frame: Frame, r: Nfl["rules"], rating: Ratings, random: Random) {
  let side: Side = random() < .5 ? 0 : 1, yard = 25, down = 1, distance = 10;
  const qb = frame.teams.map(t => role(t, "qb")[0]!);
  const receivers = frame.teams.map(t => role(t, "wr", "te", "rb"));
  const backs = frame.teams.map(t => role(t, "rb"));
  const kickers = frame.teams.map(t => role(t, "k"));
  const wet = r.wet ? .90 : 1;
  const switchSide = (start = 25) => { side = other(side); yard = Math.round(start); down = 1; distance = Math.min(10, 100 - yard); };
  for (let quarter = 1; quarter <= 4 || (quarter === 5 && frame.teams[0].score === frame.teams[1].score); quarter++) {
    record(frame, quarter === 5 ? "OT" : `Q${quarter}`, () => {
    if (quarter === 3 || quarter === 5) switchSide();
    let seconds = quarter === 5 ? 600 : 900;
    while (seconds > 0) {
      const team = frame.teams[side], opp = frame.teams[other(side)];
      const behind = opp.score - team.score;
      const late = quarter >= 4;
      const kick = yard >= 58 && (down === 4 && (distance >= 3 || !late || behind <= 3));
      const punt = down === 4 && !kick && (yard < 52 || distance > 4) && !(late && behind > 3 && seconds < 240);
      if (kick) {
        const kicker = sample(kickers[side]!, random);
        if (random() < cap(r.kickAccuracy - Math.max(0, 75 - yard) * .012 - r.windMph * .005, .12, .98) * wet) {
          team.score += 3; credit(team, kicker, "points", 3);
          switchSide();
        } else switchSide(cap(100 - yard + 7, 20, 85));
        seconds -= 12;
        continue;
      }
      if (punt) { switchSide(cap(100 - (yard + 40 + normal(random) * 8), 20, 85)); seconds -= 15; continue; }
      const isPass = random() < cap(r.passRate + (down >= 3 ? .12 : 0) + (distance - 8) * .013 +
        (late ? cap(behind * .019, -.24, .27) : 0) - (yard >= 92 ? .06 : 0), .18, .88);
      if (random() < r.giveawayRate * (isPass ? 1.15 : .80)) { switchSide(cap(100 - yard, 1, 99)); seconds -= 13; continue; }
      let gain = 0;
      let scorer: Player | undefined;
      if (isPass && random() < r.sackRate) gain = -Math.round(4 + random() * 6);
      else if (isPass) {
        scorer = sample(receivers[side]!, random, yard >= 80);
        credit(team, scorer, "targets");
        if (random() < cap(r.completion * rating[side] * wet - r.windMph * .002 - (distance >= 12 ? .05 : 0), .12, .90)) {
          gain = Math.round(cap(r.yardsPerCatch * rating[side] + normal(random) * 9, -4, 65));
          gain = Math.min(gain, 100 - yard);
          credit(team, qb[side]!, "passYards", gain);
          credit(team, scorer, "recYards", gain);
        }
      } else {
        scorer = sample(backs[side]!, random, yard >= 80);
        gain = Math.min(100 - yard, Math.round(cap(r.runYards * rating[side] + normal(random) * 5, -6, 42)));
        credit(team, scorer, "rushYards", gain);
      }
      yard += gain;
      if (yard >= 100 && scorer) {
        const extra = Number(random() < cap(.96 - r.windMph * .003, .60, .97));
        team.score += 6 + extra; credit(team, scorer, "td"); credit(team, scorer, "points", 6);
        if (extra) credit(team, sample(kickers[side]!, random), "points");
        switchSide();
      } else if (yard <= 0) {
        opp.score += 2;
        credit(opp, role(opp, "defense")[0]!, "points", 2);
        switchSide(30);
      } else {
        distance -= gain;
        down++;
        if (distance <= 0) { down = 1; distance = Math.min(10, 100 - yard); }
        else if (down > 4) switchSide(100 - yard);
      }
      seconds -= late && behind > 0 ? 19 : isPass && gain === 0 ? 13 : 35;
    }
    });
  }
}

function mlb(frame: Frame, r: Mlb["rules"], rating: Ratings, random: Random) {
  const batting = frame.teams.map(t => role(t, "batter"));
  const starters = frame.teams.map(t => role(t, "starter")[0]!);
  const platoon = frame.teams.map(t => role(t, "reliever", "closer"));
  const order = [0, 0], pitches = [0, 0], faced = [0, 0], reliefBatters = [0, 0];
  const used = [new Set<string>(), new Set<string>()] as const;
  const active: [Player | undefined, Player | undefined] = [undefined, undefined];
  let inning = 1;
  const half = (side: Side) => {
    const team = frame.teams[side], opponent = frame.teams[other(side)];
    const defenders = other(side);
    let outs = 0, appearances = 0;
    const teamBatters = batting[side]!;
    const bases: (Player | undefined)[] = [undefined,
      inning > 9 && r.automaticRunner ? teamBatters[(order[side]! + 8) % 9] : undefined, undefined];
    const run = (p: Player) => { team.score++; credit(team, p, "runs"); };
    while (outs < 3 && appearances++ < 70) {
      const batter = teamBatters[order[side]!++ % 9]!;
      if ((!active[defenders] && (pitches[defenders]! >= r.pitchLimit || faced[defenders]! >= 24)) ||
          (active[defenders] && (reliefBatters[defenders]! >= 8 ||
            (inning >= 9 && opponent.score > team.score && active[defenders]!.role !== "closer")))) {
        const unused = platoon[defenders]!.filter(p => !used[defenders].has(p.id));
        const preferred = unused.filter(p => p.role === (inning >= 9 && opponent.score > team.score ? "closer" : "reliever"));
        const replacement = preferred.length ? preferred : unused;
        if (replacement.length) {
          active[defenders] = sample(replacement, random);
          used[defenders].add(active[defenders]!.id);
          reliefBatters[defenders] = 0;
        }
      }
      const pitcher = active[defenders] ?? starters[defenders]!;
      pitches[defenders]! += 3 + Math.floor(random() * 4);
      faced[defenders]!++;
      if (active[defenders]) reliefBatters[defenders]!++;
      const fatigue = active[defenders] ? 1 : 1 + .025 * Math.floor(faced[defenders]! / 9);
      const oppositeHand = batter.hand === "S" || (batter.hand && pitcher.hand && batter.hand !== pitcher.hand);
      const weights = r.outcomes.slice();
      const offense = rating[side] * fatigue * (oppositeHand ? 1.06 : 1) * r.parkFactor * (batter.hitFactor ?? 1) / (pitcher.hitFactor ?? 1);
      weights[0]! *= (batter.strikeoutFactor ?? 1) * (pitcher.strikeoutFactor ?? 1);
      for (let i = 3; i <= 6; i++) weights[i]! *= offense;
      weights[6]! *= cap(1 + r.windOutMph * .012, .7, 1.4);
      let rand = random() * weights.reduce((a,b)=>a+b,0);
      const result = weights.findIndex(w => (rand -= w) < 0);
      credit(team, batter, "pa");
      if (result === 0 || result === 7 || result < 0) {
        outs++;
        if (result === 0) { credit(team, batter, "strikeouts"); credit(opponent, pitcher, "pitcherK"); }
      } else if (result === 1 || result === 2) {
        if (bases[0]) {
          if (bases[1]) { if (bases[2]) run(bases[2]); bases[2] = bases[1]; }
          bases[1] = bases[0];
        }
        bases[0] = batter;
      } else {
        const steps = result - 2;
        credit(team, batter, "hits");
        for (let i = 2; i >= 0; i--) {
          const runner = bases[i];
          if (!runner) continue;
          bases[i] = undefined;
          if (i + steps >= 3) run(runner); else bases[i + steps] = runner;
        }
        if (steps === 4) run(batter); else bases[steps - 1] = batter;
      }
      if (inning >= 9 && side === 0 && team.score > opponent.score) break;
    }
  };
  for (; inning <= 9 || frame.teams[0].score === frame.teams[1].score; inning++) {
    if (inning > 30) throw new RangeError("Unresolved baseball extra innings");
    record(frame, `Inning ${inning}`, () => {
      half(1); if (inning < 9 || frame.teams[0].score <= frame.teams[1].score) half(0);
    });
  }
}

function nhl(frame: Frame, r: Nhl["rules"], rating: Ratings, random: Random) {
  const goalies = sides.map(side => (r.goalieSave[side] * r.goalieShots[side] + r.tourSave * 900) / (r.goalieShots[side] + 900));
  const skaters = frame.teams.map(t => role(t, "skater", "power_play"));
  const pp = frame.teams.map(t => role(t, "power_play"));
  const minute = (side: Side, late: boolean, overtime: boolean) => {
    const team = frame.teams[side], opp = frame.teams[other(side)];
    const behind = opp.score - team.score;
    const powerPlay = !overtime && random() < .13;
    const players = powerPlay && pp[side]!.length ? pp[side]! : skaters[side]!;
    const shots = r.shotsPer60[side] / 60 * (behind > 0 ? 1.15 : .95) * (powerPlay ? 1.6 : overtime ? 1.25 : 1);
    const count = Math.floor(shots) + Number(random() < shots % 1);
    for (let i = 0; i < count; i++) {
      const shooter = sample(players, random);
      credit(team, shooter, "shots");
      const emptyNet = late && behind < 0 && behind >= -2;
      const chance = (powerPlay ? r.powerPlayXg : r.xgPerShot) * rating[side] +
        (r.tourSave - goalies[other(side)]!) + (emptyNet ? .20 : overtime ? .025 : 0);
      if (random() < cap(chance, .005, .75)) {
        team.score++; credit(team, shooter, "goals"); credit(team, shooter, "points");
        const eligible = players.filter(p => p !== shooter);
        if (eligible.length && random() < .85) {
          const helper = sample(eligible, random);
          credit(team, helper, "assists"); credit(team, helper, "points");
        }
        if (overtime) return;
      }
    }
  };
  for (let period = 1; period <= 3; period++) record(frame, `P${period}`, () => {
    for (let i = 0; i < 20; i++) for (const side of sides) minute(side, period === 3 && i >= 18, false);
  });
  for (let overtime = 1; frame.teams[0].score === frame.teams[1].score; overtime++) {
    if (overtime > 20) throw new RangeError("Unresolved hockey overtime");
    record(frame, `OT ${overtime}`, () => {
      for (let i = 0; i < (r.playoffs ? 20 : 5) && frame.teams[0].score === frame.teams[1].score; i++) {
        const first: Side = random() < .5 ? 0 : 1;
        minute(first, false, true);
        if (frame.teams[0].score === frame.teams[1].score) minute(other(first), false, true);
      }
    });
    if (!r.playoffs) {
      if (frame.teams[0].score === frame.teams[1].score) {
        frame.winner = random() < rating[0] / (rating[0] + rating[1]) ? 0 : 1;
        frame.tiebreak = "shootout";
      }
      break;
    }
  }
}

function soccer(frame: Frame, r: Soccer["rules"], rating: Ratings, random: Random) {
  const dismissed: (Player | undefined)[] = [undefined, undefined];
  const players = frame.teams.map(t => role(t, "outfield", "sub"));
  let clock = 0;
  const finishing = .92 + random() * .16;
  const period = (label: string, minutes: number) => record(frame, label, () => {
    for (let i = 0; i < minutes; i++, clock++) for (const side of sides) {
      const team = frame.teams[side], opp = frame.teams[other(side)];
      const behind = opp.score - team.score;
      if (!dismissed[side] && random() < r.redRate / 90) dismissed[side] = sample(players[side]!, random);
      const on = players[side]!.filter(p => p !== dismissed[side] && (p.role !== "sub" || clock >= 60));
      if (!on.length) continue;
      const rate = r.shots[side] / 90 * (dismissed[side] ? .72 : 1) * (behind > 0 && clock >= 60 ? 1.22 : behind < 0 ? .88 : 1);
      if (random() >= rate) continue;
      const p = sample(on, random);
      credit(team, p, "shots");
      if (random() >= .37) continue;
      credit(team, p, "onTarget");
      const lowScore = team.score <= 1 && opp.score <= 1 && team.score === opp.score;
      const chance = r.xg[side] / r.shots[side] / .37 * rating[side] * finishing *
        (lowScore ? 1 - r.lowScoreAdjustment : 1) * (dismissed[other(side)] ? 1.20 : 1);
      if (random() < cap(chance, .015, .80)) { team.score++; credit(team, p, "goals"); }
    }
  });
  period("1H", 45); period("2H", 45);
  frame.regulation = [frame.teams[0].score, frame.teams[1].score];
  if (r.knockout && frame.teams[0].score === frame.teams[1].score) {
    period("ET 1", 15); period("ET 2", 15);
    if (frame.teams[0].score === frame.teams[1].score) {
      frame.winner = random() < rating[0] / (rating[0] + rating[1]) ? 0 : 1;
      frame.tiebreak = "penalties";
    }
  }
}

function tennis(frame: Frame, r: Tennis["rules"], rating: Ratings, random: Random) {
  const players = frame.teams.map(t => role(t, "server")[0]!);
  let server: Side = random() < .5 ? 0 : 1;
  const sets = [0, 0];
  const retireAt = sides.map(s => random() < r.retirement[s] ? 16 + Math.floor(random() * 115) : Infinity);
  let played = 0;
  const point = (side: Side): Side => {
    const team = frame.teams[side], player = players[side]!;
    played++;
    credit(team, player, "servePoints");
    const chance = cap((r.serve[side] * r.serveSample[side] + r.tourServe * 350) /
      (r.serveSample[side] + 350) * rating[side], .35, .85);
    const p = random();
    if (p < Math.min(r.ace[side], chance)) credit(team, player, "aces");
    else if (p >= 1 - Math.min(r.doubleFault[side], 1 - chance)) credit(team, player, "doubleFaults");
    return p < chance ? side : other(side);
  };
  const scoring = (tb: number) => {
    const points = [0, 0], need = tb || 4;
    const first = server;
    let i = 0;
    while (Math.max(...points) < need || Math.abs(points[0]! - points[1]!) < 2) {
      if (i >= 200) throw new RangeError("Unresolved tennis point sequence");
      if (played >= Math.min(...retireAt)) { frame.retired = retireAt[0]! <= retireAt[1]! ? 0 : 1; return undefined; }
      const current = tb && i > 0 && Math.floor((i + 1) / 2) % 2 ? other(first) : first;
      points[point(current)]!++; i++;
    }
    server = other(first);
    return points[0]! > points[1]! ? 0 : 1;
  };
  const needed = Math.ceil(r.bestOf / 2);
  for (let set = 1; Math.max(...sets) < needed && frame.retired == null; set++) record(frame, `Set ${set}`, () => {
    const games = [0, 0];
    const tie = set === r.bestOf ? r.decidingTiebreak : 7;
    while (Math.max(...games) < 6 || Math.abs(games[0]! - games[1]!) < 2) {
      if (games[0]! + games[1]! >= 150) throw new RangeError("Unresolved tennis set");
      const tiebreak = games[0] === 6 && games[1] === 6 ? tie ?? 0 : 0;
      const won = scoring(tiebreak);
      if (won == null) return;
      games[won]!++; frame.teams[won].score++; credit(frame.teams[won], players[won]!, "games");
      if (tiebreak) break;
    }
    const setWinner: Side = games[0]! > games[1]! ? 0 : 1;
    sets[setWinner]!++;
    credit(frame.teams[setWinner], players[setWinner]!, "sets");
  });
  frame.winner = frame.retired != null ? other(frame.retired) : sets[0]! > sets[1]! ? 0 : 1;
}

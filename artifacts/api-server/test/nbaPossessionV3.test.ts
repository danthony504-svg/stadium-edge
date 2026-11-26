import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nbaPossessionReview } from "../src/lib/sportSim/nbaPossessionReview.ts";
import { nbaDrawBox, nbaLineProbability, nbaPlayerProp, simulateNbaPossessions, summarizeNbaDraws, type NbaPregame } from "../src/lib/sportSim/nbaPossessionV3.ts";
import { backtestNbaPossessions } from "../src/lib/sportSim/nbaPossessionBacktest.ts";

const team = (id: string): NbaPregame["home"] => ({
  id, lineupSource: "fixture", lineupConfirmedAt: 190, offense: 116, defense: 112, ratingGames: 20, pace: 100, restDays: 2,
  turnoverRate: .13, shotMix: [.34, .26, .4], makeRate: [.64, .43, .37],
  offensiveReboundRate: .26, freeThrowTripRate: .105, freeThrowPct: .78,
  players: [34, 32, 30, 29, 27, 23, 22, 17, 14, 12, 0].map((minutes, index) => ({
    id: `${id}-${index}`, name: `Player ${index}`, starter: index < 5, minutes,
    ...(index === 5 ? { minutesLimit: 25 } : {}),
    role: [.5 - .03 * index, .14, .2],
  })),
});
const snapshot: NbaPregame = {
  eventId: "event", availableAt: 200, startsAt: 300, home: team("home"), away: team("away"),
  leagueRating: 114, leaguePace: 100, homeCourtPoints: 2.5, ratingSd: 5,
  market: { fairHomeMargin: 3, fairTotal: 225, availableAt: 150 },
};
const draws = simulateNbaPossessions(snapshot, 71);
const queries = [
  { id: "home-3", kind: "spread", teamSide: "home", line: -3 },
  { id: "home-3.5", kind: "spread", teamSide: "home", line: -3.5 },
  { id: "away+3", kind: "spread", teamSide: "away", line: 3 },
  { id: "over-225", kind: "total", totalSide: "over", line: 225 },
  { id: "under-225", kind: "total", totalSide: "under", line: 225 },
] as const;

test("10,000 NBA games reconcile every box and period, including overtime and minute caps", () => {
  assert.equal(draws.homeScores.length, 10_000);
  assert.ok(draws.periods.some(periods => periods.length > 4));
  for (const [i, periods] of draws.periods.entries()) {
    assert.notEqual(draws.homeScores[i], draws.awayScores[i]);
    if (periods.length > 4) assert.equal(periods.slice(0, 4).reduce((sum, p) => sum + p.home - p.away, 0), 0);
    for (const side of ["home", "away"] as const) {
      const teamScore = side === "home" ? draws.homeScores[i] : draws.awayScores[i];
      const players = nbaDrawBox(draws, side, i);
      assert.equal(players.reduce((sum, p) => sum + p.points, 0), teamScore);
      assert.equal(periods.reduce((sum, p) => sum + p[side], 0), teamScore);
      assert.equal(players.reduce((sum, p) => sum + p.minutes, 0), (48 + (periods.length - 4) * 5) * 5);
      assert.ok(players[5]!.minutes <= 25);
      assert.equal(players[10]!.minutes, 0);
    }
  }
});

test("same draws score alternate lines, exact pushes, and the real median-margin replay", () => {
  const meta = summarizeNbaDraws(draws, queries, false).nbaPossessions;
  const rates = meta.lines;
  for (const [a, b] of [["home-3", "away+3"], ["over-225", "under-225"]]) {
    assert.ok(rates[a!]!.push > 0);
    assert.equal(rates[a!]!.push, rates[b!]!.push);
    assert.ok(Math.abs(rates[a!]!.win + rates[b!]!.win + rates[a!]!.push - 1) < 1e-12);
  }
  assert.equal(rates["home-3.5"]!.push, 0);
  assert.equal(rates["home-3"]!.win, rates["home-3.5"]!.win);
  assert.deepEqual(nbaLineProbability(draws, queries[2]!), rates["away+3"]);
  const prop = { athleteId: "home-0", stat: "points", teamSide: "home", line: 20, side: "over" } as const;
  const player = nbaPlayerProp(draws, prop, queries[0]!)!;
  const sameDraws = draws.homeScores.reduce((sum, score, i) =>
    sum + Number(score - 3 > draws.awayScores[i]! && nbaDrawBox(draws, "home", i)[0]!.points > 20), 0);
  assert.equal(player.jointWin, sameDraws / 10_000);
  assert.ok(player.jointWin! <= player.win && player.jointWin! <= rates["home-3"]!.win);
  assert.equal(meta.marginHistogram.reduce((n, b) => n + b.count, 0), 10_000);
  assert.equal(meta.representative.periods.reduce((sum, p) => sum + p.home - p.away, 0), meta.representative.margin);
  assert.equal(meta.representative.percentile, 50);
  assert.ok(meta.homeWinRange80[0]! < meta.homeWinRange80[1]!);
});

test("a future anchor is rejected, and deterministic draws survive a repeat", () => {
  assert.throws(() => simulateNbaPossessions({ ...snapshot, market: { ...snapshot.market!, availableAt: 205 } }), /snapshot/);
  const rerun = simulateNbaPossessions(snapshot, 71);
  assert.deepEqual(rerun.homeScores, draws.homeScores);
  assert.deepEqual(rerun.awayScores, draws.awayScores);
});

test("backtest scores paired closing forecasts, counts pushes and rejects post-tip closing data", () => {
  const captured = { snapshot, final: { home: 115, away: 112, availableAt: 401 },
    open: { homeSpread: -3, availableAt: 190 }, close: { homeSpread: -4, availableAt: 280, fairHomeWin: .59 } };
  const result = backtestNbaPossessions([captured]);
  assert.equal(result.win.paired, 1);
  assert.equal(result.cover.settled, 0);
  assert.equal(result.pushes, 1);
  assert.equal(result.closingMargin.games, 1);
  assert.equal(result.closingMargin.actualMeanError, -1);
  assert.equal(result.closingMargin.actualErrorSd, null);
  assert.equal(result.closingMargin.actualPushRate, 0);
  assert.ok(result.closingMargin.simulatedPushRate! > 0);
  assert.throws(() => backtestNbaPossessions([{ ...captured, close: { ...captured.close, availableAt: 310 } }]), /invalid/i);
});


test("pregame injury transfers bind replacement minutes and remove the unavailable player", () => {
  const replacement = snapshot.home.players[7]!;
  const unavailable = snapshot.home.players[9]!;
  const injured = {
    ...snapshot,
    home: { ...snapshot.home, rotationChanges: [{
      unavailableId: unavailable.id, replacementId: replacement.id, minutes: unavailable.minutes,
    }] },
  };
  const scenario = simulateNbaPossessions(injured, 71);
  assert.equal(scenario.input.home.players[7]!.minutes, 29);
  assert.equal(scenario.input.home.players[9]!.minutes, 0);
  for (let i = 0; i < scenario.homeScores.length; i++) assert.equal(nbaDrawBox(scenario, "home", i)[9]!.minutes, 0);
  assert.throws(() => simulateNbaPossessions({ ...snapshot, away: { ...snapshot.away, lineupConfirmedAt: 201 } }), /rotation/);
});


test("review only uses the exact event and reuses draws as a posted line changes", async () => {
  const previous = process.env.NBA_POSSESSION_REVIEW_SNAPSHOTS;
  const directory = await mkdtemp(join(tmpdir(), "stadium-nba-possession-"));
  const file = join(directory, "pregame.json");
  try {
    await writeFile(file, JSON.stringify([snapshot]));
    process.env.NBA_POSSESSION_REVIEW_SNAPSHOTS = file;
    const request = { eventId: "event", homeId: "home", awayId: "away", retainOutcomes: true };
    assert.equal(await nbaPossessionReview({ ...request, homeId: "wrong", queries: [] }), null);
    const first = await nbaPossessionReview({ ...request, queries: [queries[0]!] });
    const next = await nbaPossessionReview({ ...request, queries: [queries[1]!] });
    assert.equal(first?.nbaDrawCacheHit, false);
    assert.equal(next?.nbaDrawCacheHit, true);
    assert.deepEqual(first?.outcomes, next?.outcomes);
    assert.equal(next?.nbaPossessions.lines["home-3.5"]?.push, 0);
  } finally {
    if (previous == null) delete process.env.NBA_POSSESSION_REVIEW_SNAPSHOTS;
    else process.env.NBA_POSSESSION_REVIEW_SNAPSHOTS = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("WNBA records 40-minute regulation and reconciles player points in every draw", () => {
  const scale = (t: NbaPregame["home"]) => ({
    ...t, pace: 83, restDays: 1,
    players: t.players.map(p => ({ ...p, minutes: p.minutes * 5 / 6 })),
  });
  const wnba = simulateNbaPossessions({ ...snapshot, sport: "wnba", leaguePace: 83,
    home: scale(snapshot.home), away: scale(snapshot.away), market: undefined }, 71);
  for (const [i, periods] of wnba.periods.entries()) {
    const players = nbaDrawBox(wnba, "home", i);
    assert.equal(players.reduce((sum, p) => sum + p.minutes, 0), (40 + (periods.length - 4) * 5) * 5);
    assert.equal(players.reduce((sum, p) => sum + p.points, 0), wnba.homeScores[i]);
  }
  assert.equal(summarizeNbaDraws(wnba, [], false).simModel, "wnba-possession-v3");
});

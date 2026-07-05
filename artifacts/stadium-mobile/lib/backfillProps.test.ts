import assert from "node:assert/strict";
import { test } from "node:test";
import { backfillProps } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";

const GAME = "New York Yankees @ Boston Red Sox";
const REAL_TODAY = [
  {
    game: GAME,
    market: "Moneyline",
    pick: "Red Sox ML",
    odds: -105,
    sport: "mlb",
    startsAt: "2026-06-28T22:00:00.000Z",
  },
];

function prop(
  player: string,
  marketLabel: string,
  odds: number,
): PropPoolEntry {
  return {
    sport: "mlb",
    game: GAME,
    marketLabel,
    player,
    line: 0.5,
    side: "Over",
    odds,
    marketKey: "test",
    headshot: null,
    teamAbbr: "BOS",
    athleteId: "1",
    startsAt: "2026-06-28T22:00:00.000Z",
  };
}

test("backfillProps diversifies across markets instead of stacking one stat", () => {
  const pool: PropPoolEntry[] = [];
  for (let i = 0; i < 8; i++) {
    pool.push(prop(`SB Player ${i}`, "Stolen Bases", 300 + i * 20));
  }
  for (let i = 0; i < 8; i++) {
    pool.push(prop(`Hit Player ${i}`, "Hits", -110));
  }
  for (let i = 0; i < 4; i++) {
    pool.push(prop(`HR Player ${i}`, "Home Runs", 350));
  }
  const out = backfillProps([], pool, REAL_TODAY, [], {
    target: 9,
    diversify: true,
    maxPerMarket: 3,
    plusMoneyBias: true,
  });
  assert.equal(out.length, 9);
  const markets = new Set(out.map((p) => p.market));
  assert.ok(markets.size >= 3, `expected mixed markets, got: ${[...markets].join(", ")}`);
  const sb = out.filter((p) => p.market === "Stolen Bases").length;
  assert.ok(sb <= 3, `too many stolen-base legs: ${sb}`);
});

test("backfillProps spreads props across games and sports on deep tickets", () => {
  const games = [
    { game: "Yankees @ Red Sox", sport: "mlb", startsAt: "2026-06-28T22:00:00.000Z" },
    { game: "Lakers @ Celtics", sport: "nba", startsAt: "2026-06-28T23:30:00.000Z" },
    { game: "Rangers @ Bruins", sport: "nhl", startsAt: "2026-06-28T23:00:00.000Z" },
    { game: "Dodgers @ Giants", sport: "mlb", startsAt: "2026-06-28T23:45:00.000Z" },
  ];
  const realToday = games.flatMap((g) => [
    {
      game: g.game,
      market: "Moneyline",
      pick: "Home ML",
      odds: -110,
      sport: g.sport,
      startsAt: g.startsAt,
    },
  ]);
  const pool: PropPoolEntry[] = [];
  for (const g of games) {
    for (let i = 0; i < 6; i++) {
      pool.push({
        sport: g.sport,
        game: g.game,
        marketLabel: i % 2 === 0 ? "Points" : "Hits",
        player: `Player ${g.sport} ${i}`,
        line: 1.5,
        side: "Over",
        odds: 120 + i * 10,
        marketKey: "test",
        headshot: null,
        teamAbbr: "TST",
        athleteId: String(i),
        startsAt: g.startsAt,
      });
    }
  }
  const out = backfillProps([], pool, realToday, [], {
    target: 12,
    diversify: true,
  });
  assert.equal(out.length, 12);
  const gameLabels = new Set(out.map((p) => p.game));
  const sports = new Set(out.map((p) => p.sport));
  assert.ok(gameLabels.size >= 3, `expected 3+ games, got ${gameLabels.size}`);
  assert.ok(sports.size >= 2, `expected 2+ sports, got ${sports.size}`);
  const perGame = new Map<string, number>();
  for (const p of out) perGame.set(p.game, (perGame.get(p.game) ?? 0) + 1);
  for (const [g, n] of perGame) {
    assert.ok(n <= 2, `too many legs on ${g}: ${n}`);
  }
});

test("backfillProps varies first leg across build seeds", () => {
  const games = [
    { game: "Cardinals @ Cubs", sport: "mlb", startsAt: "2026-06-28T19:00:00.000Z" },
    { game: "Yankees @ Red Sox", sport: "mlb", startsAt: "2026-06-28T22:00:00.000Z" },
    { game: "Dodgers @ Giants", sport: "mlb", startsAt: "2026-06-28T23:45:00.000Z" },
  ];
  const realToday = games.flatMap((g) => [
    {
      game: g.game,
      market: "Moneyline",
      pick: "Home ML",
      odds: -110,
      sport: g.sport,
      startsAt: g.startsAt,
    },
  ]);
  const pool: PropPoolEntry[] = [];
  for (const g of games) {
    pool.push({
      sport: g.sport,
      game: g.game,
      marketLabel: "Hits",
      player: `Hits Star ${g.game}`,
      line: 1.5,
      side: "Over",
      odds: 220,
      marketKey: "hits",
      headshot: null,
      teamAbbr: "TST",
      athleteId: "1",
      startsAt: g.startsAt,
    });
    pool.push({
      sport: g.sport,
      game: g.game,
      marketLabel: "Strikeouts",
      player: `K Star ${g.game}`,
      line: 5.5,
      side: "Over",
      odds: 180,
      marketKey: "k",
      headshot: null,
      teamAbbr: "TST",
      athleteId: "2",
      startsAt: g.startsAt,
    });
  }
  const firstA = backfillProps([], pool, realToday, [], {
    target: 3,
    diversify: true,
    plusMoneyBias: true,
    varietySeed: "alpha-build",
  })[0]!;
  const firstB = backfillProps([], pool, realToday, [], {
    target: 3,
    diversify: true,
    plusMoneyBias: true,
    varietySeed: "beta-build",
  })[0]!;
  assert.notEqual(
    `${firstA.market}|${firstA.player}`,
    `${firstB.market}|${firstB.player}`,
    "rotated market start should change the lead leg",
  );
});

test("backfillProps varies ticket mix across build seeds", () => {
  const games = [
    { game: "Cardinals @ Cubs", sport: "mlb", startsAt: "2026-06-28T19:00:00.000Z" },
    { game: "Yankees @ Red Sox", sport: "mlb", startsAt: "2026-06-28T22:00:00.000Z" },
    { game: "Dodgers @ Giants", sport: "mlb", startsAt: "2026-06-28T23:45:00.000Z" },
  ];
  const realToday = games.flatMap((g) => [
    {
      game: g.game,
      market: "Moneyline",
      pick: "Home ML",
      odds: -110,
      sport: g.sport,
      startsAt: g.startsAt,
    },
  ]);
  const pool: PropPoolEntry[] = [];
  for (const g of games) {
    for (let i = 0; i < 10; i++) {
      pool.push({
        sport: g.sport,
        game: g.game,
        marketLabel: i % 3 === 0 ? "Hits" : i % 3 === 1 ? "Strikeouts" : "Home Runs",
        player: `Star ${g.game} ${i}`,
        line: 1.5,
        side: "Over",
        odds: 150 + i * 5,
        marketKey: "test",
        headshot: null,
        teamAbbr: "TST",
        athleteId: String(i),
        startsAt: g.startsAt,
      });
    }
  }
  const ticketA = backfillProps([], pool, realToday, [], {
    target: 12,
    diversify: true,
    varietySeed: "seed-alpha",
  });
  const ticketB = backfillProps([], pool, realToday, [], {
    target: 12,
    diversify: true,
    varietySeed: "seed-beta",
  });
  const key = (p: { game: string; pick: string }) => `${p.game}|${p.pick}`;
  const legsA = ticketA.map(key).join(";");
  const legsB = ticketB.map(key).join(";");
  assert.notEqual(legsA, legsB, "different build seeds should produce different tickets");
});

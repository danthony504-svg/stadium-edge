import assert from "node:assert/strict";
import { test } from "node:test";

import {
  americanToDecimal,
  computeArb,
  computeStakes,
  findGameLineArbs,
  findPropArbs,
  guaranteedReturn,
  impliedProb,
  type ArbGame,
  type ArbPropGame,
} from "./arbitrage.ts";

test("impliedProb / americanToDecimal", () => {
  assert.equal(impliedProb(100), 0.5);
  assert.ok(Math.abs(impliedProb(-110) - 0.5238) < 0.001);
  assert.ok(Math.abs(impliedProb(120) - 0.4545) < 0.001);
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(-100), 2);
});

test("computeArb flags a real arb and rejects a vigged pair", () => {
  // +110 (0.4762) and -100 (0.5) -> sum 0.9762 < 1 => arb ~2.4%
  const arb = computeArb([110, -100]);
  assert.ok(arb);
  assert.ok(arb!.profitPct > 2 && arb!.profitPct < 3);
  // two -110 sides -> sum 1.0476 => no arb
  assert.equal(computeArb([-110, -110]), null);
});

test("computeStakes equalizes payout and guaranteedReturn matches", () => {
  const arb = computeArb([110, -100])!;
  const stakes = computeStakes(arb.impl, 100);
  // total stake preserved (within rounding)
  assert.ok(Math.abs(stakes[0] + stakes[1] - 100) < 0.05);
  // each side returns the same amount = the guaranteed return
  const ret0 = stakes[0] * americanToDecimal(110);
  const ret1 = stakes[1] * americanToDecimal(-100);
  assert.ok(Math.abs(ret0 - ret1) < 0.2);
  const gr = guaranteedReturn(arb.impl, 100);
  assert.ok(gr > 100 && Math.abs(gr - ret0) < 0.5);
});

test("findGameLineArbs detects a totals arb across two books", () => {
  const games: ArbGame[] = [
    {
      id: "g1",
      sport: "nba",
      homeTeam: "Lakers",
      awayTeam: "Celtics",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "totals",
          outcomes: [
            { name: "Over", point: 20.5, price: 110, books: [{ book: "DraftKings", price: 110 }, { book: "MGM", price: -105 }] },
            { name: "Under", point: 20.5, price: -100, books: [{ book: "FanDuel", price: -100 }, { book: "MGM", price: -120 }] },
          ],
        },
      ],
    },
  ];
  const arbs = findGameLineArbs(games);
  assert.equal(arbs.length, 1);
  const a = arbs[0];
  assert.equal(a.kind, "game");
  assert.equal(a.legs.length, 2);
  const over = a.legs.find((l) => l.label.startsWith("Over"))!;
  const under = a.legs.find((l) => l.label.startsWith("Under"))!;
  assert.equal(over.book, "DraftKings");
  assert.equal(over.price, 110);
  assert.equal(under.book, "FanDuel");
  assert.equal(under.price, -100);
});

test("findGameLineArbs detects a moneyline arb and skips a vigged one", () => {
  const games: ArbGame[] = [
    {
      id: "g2",
      sport: "nba",
      homeTeam: "Heat",
      awayTeam: "Knicks",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Knicks", price: 115, books: [{ book: "DK", price: 115 }] },
            { name: "Heat", price: -100, books: [{ book: "FD", price: -100 }] },
          ],
        },
      ],
    },
    {
      id: "g3",
      sport: "nba",
      homeTeam: "Bulls",
      awayTeam: "Nets",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Nets", price: -110, books: [{ book: "DK", price: -110 }] },
            { name: "Bulls", price: -110, books: [{ book: "FD", price: -110 }] },
          ],
        },
      ],
    },
  ];
  const arbs = findGameLineArbs(games);
  assert.equal(arbs.length, 1);
  assert.equal(arbs[0].game, "Knicks @ Heat");
});

test("findGameLineArbs pairs mirrored spread lines", () => {
  const games: ArbGame[] = [
    {
      id: "g4",
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "spreads",
          outcomes: [
            { name: "Jets", point: 3.5, price: 110, books: [{ book: "DK", price: 110, point: 3.5 }] },
            { name: "Bills", point: -3.5, price: -100, books: [{ book: "FD", price: -100, point: -3.5 }] },
          ],
        },
      ],
    },
  ];
  const arbs = findGameLineArbs(games);
  assert.equal(arbs.length, 1);
  assert.equal(arbs[0].legs.length, 2);
  assert.ok(arbs[0].legs.some((l) => l.label.includes("+3.5")));
  assert.ok(arbs[0].legs.some((l) => l.label.includes("-3.5")));
});

test("findGameLineArbs skips outcomes with no named book", () => {
  const games: ArbGame[] = [
    {
      id: "g5",
      sport: "nba",
      homeTeam: "A",
      awayTeam: "B",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "B", price: 115, books: [] },
            { name: "A", price: -100, books: [{ book: "FD", price: -100 }] },
          ],
        },
      ],
    },
  ];
  assert.equal(findGameLineArbs(games).length, 0);
});

test("findPropArbs detects an over/under prop arb with both books", () => {
  const games: ArbPropGame[] = [
    {
      game: "Celtics @ Lakers",
      sport: "nba",
      startsAt: "2026-06-12T00:00:00Z",
      props: [
        {
          player: "Jayson Tatum",
          market: "player_points",
          line: 27.5,
          overPrice: 120,
          underPrice: -110,
          overBook: "DraftKings",
          underBook: "Caesars",
        },
        // vigged prop -> no arb
        {
          player: "Anthony Davis",
          market: "player_points",
          line: 22.5,
          overPrice: -115,
          underPrice: -105,
          overBook: "DK",
          underBook: "FD",
        },
        // missing under book -> skipped
        {
          player: "LeBron James",
          market: "player_points",
          line: 25.5,
          overPrice: 130,
          underPrice: -110,
          overBook: "DK",
          underBook: null,
        },
      ],
    },
  ];
  const arbs = findPropArbs(games);
  assert.equal(arbs.length, 1);
  const a = arbs[0];
  assert.equal(a.kind, "prop");
  assert.equal(a.player, "Jayson Tatum");
  assert.equal(a.legs[0].label, "Over 27.5");
  assert.equal(a.legs[0].book, "DraftKings");
  assert.equal(a.legs[1].label, "Under 27.5");
  assert.equal(a.legs[1].book, "Caesars");
});

test("profit cap is enforced against the raw (unrounded) edge", () => {
  // A boundary edge that rounds UP to 0.1 but is really below the floor must be
  // rejected; a real 2.4% arb must pass.
  const games = (overPrice: number, underPrice: number): ArbPropGame[] => [
    {
      game: "X @ Y",
      sport: "nba",
      props: [
        {
          player: "P",
          market: "player_points",
          line: 20.5,
          overPrice,
          underPrice,
          overBook: "DK",
          underBook: "FD",
        },
      ],
    },
  ];
  // +100 vs -101 -> impl 0.5 + 0.50249 = 1.00249 => no arb at all
  assert.equal(findPropArbs(games(100, -101)).length, 0);
  // +101 vs -100 -> impl 0.49751 + 0.5 = 0.99751 => raw ~0.249% (passes 0.1 floor)
  assert.equal(findPropArbs(games(101, -100)).length, 1);
  // huge stale line -> raw far above 30% ceiling => rejected
  assert.equal(findPropArbs(games(400, 400)).length, 0);
});

test("same-book both sides is rejected (not a cross-book arb)", () => {
  const games: ArbPropGame[] = [
    {
      game: "X @ Y",
      sport: "nba",
      props: [
        {
          player: "P",
          market: "player_points",
          line: 20.5,
          overPrice: 120,
          underPrice: -110,
          overBook: "DraftKings",
          underBook: "DraftKings", // same book → reject
        },
      ],
    },
  ];
  assert.equal(findPropArbs(games).length, 0);
});

test("findGameLineArbs rejects same-book both sides and malformed groups", () => {
  // Both legs best-priced at the same book -> not a real cross-book arb.
  const sameBook: ArbGame[] = [
    {
      id: "g1",
      sport: "nba",
      homeTeam: "Lakers",
      awayTeam: "Celtics",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "totals",
          outcomes: [
            { name: "Over", point: 20.5, price: 110, books: [{ book: "DK", price: 110 }] },
            { name: "Under", point: 20.5, price: -100, books: [{ book: "DK", price: -100 }] },
          ],
        },
      ],
    },
  ];
  assert.equal(findGameLineArbs(sameBook).length, 0);

  // Two "Over" outcomes sharing a point is not a mutually-exclusive pair.
  const twoOvers: ArbGame[] = [
    {
      id: "g2",
      sport: "nba",
      homeTeam: "A",
      awayTeam: "B",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "totals",
          outcomes: [
            { name: "Over", point: 20.5, price: 110, books: [{ book: "DK", price: 110 }] },
            { name: "Over", point: 20.5, price: -100, books: [{ book: "FD", price: -100 }] },
          ],
        },
      ],
    },
  ];
  assert.equal(findGameLineArbs(twoOvers).length, 0);

  // Same-sign "mirrored" spread (both +3.5) is not opposite sides.
  const sameSignSpread: ArbGame[] = [
    {
      id: "g3",
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      commenceTime: "2026-06-12T00:00:00Z",
      markets: [
        {
          key: "spreads",
          outcomes: [
            { name: "Jets", point: 3.5, price: 110, books: [{ book: "DK", price: 110, point: 3.5 }] },
            { name: "Bills", point: 3.5, price: -100, books: [{ book: "FD", price: -100, point: 3.5 }] },
          ],
        },
      ],
    },
  ];
  assert.equal(findGameLineArbs(sameSignSpread).length, 0);
});

test("findPropArbs labels yes/no markets", () => {
  const games: ArbPropGame[] = [
    {
      game: "X @ Y",
      sport: "nfl",
      props: [
        {
          player: "Some Player",
          market: "player_anytime_td",
          line: null,
          overPrice: 130,
          underPrice: -115,
          overBook: "DK",
          underBook: "FD",
        },
      ],
    },
  ];
  const arbs = findPropArbs(games);
  assert.equal(arbs.length, 1);
  assert.equal(arbs[0].legs[0].label, "Yes");
  assert.equal(arbs[0].legs[1].label, "No");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findGameLineArbs,
  findGameLineValueBets,
  findPropArbs,
  findPropValueBets,
  type ArbGame,
  type ArbPropGame,
} from "../src/lib/edgeLock.ts";

// A two-sided h2h market where each side's BEST book is at a DISTINCT sportsbook
// and the combined implied prob is < 100% — a genuine, placeable arb.
function arbGame(): ArbGame {
  return {
    id: "g1",
    sport: "mlb",
    homeTeam: "St. Louis Cardinals",
    awayTeam: "Minnesota Twins",
    commenceTime: new Date().toISOString(),
    markets: [
      {
        key: "h2h",
        outcomes: [
          {
            name: "Minnesota Twins",
            price: 120,
            point: null,
            books: [
              { book: "DraftKings", price: 120 },
              { book: "FanDuel", price: 105 },
            ],
          },
          {
            name: "St. Louis Cardinals",
            price: 110,
            point: null,
            books: [
              { book: "BetMGM", price: 110 },
              { book: "Caesars", price: 100 },
            ],
          },
        ],
      },
    ],
  };
}

test("findGameLineArbs detects a real two-book h2h arb", () => {
  const arbs = findGameLineArbs([arbGame()]);
  assert.equal(arbs.length, 1);
  const a = arbs[0]!;
  assert.ok(a.profitPct > 0);
  // Each leg must name a DISTINCT real sportsbook (honesty: you can place both).
  const books = a.legs.map((l) => l.book);
  assert.equal(new Set(books).size, books.length);
  assert.ok(a.legs.every((l) => l.book.trim().length > 0));
});

test("same-book both sides is rejected (not a placeable arb)", () => {
  const g = arbGame();
  // Force both sides' best price onto the SAME book.
  g.markets[0].outcomes[0].books = [{ book: "DraftKings", price: 120 }];
  g.markets[0].outcomes[1].books = [{ book: "DraftKings", price: 110 }];
  assert.equal(findGameLineArbs([g]).length, 0);
});

test("a side with no named book is skipped (fail-closed)", () => {
  const g = arbGame();
  g.markets[0].outcomes[1].books = [];
  assert.equal(findGameLineArbs([g]).length, 0);
});

test("findPropArbs needs a real book on each side", () => {
  const base = {
    game: "Minnesota Twins @ St. Louis Cardinals",
    sport: "mlb",
    startsAt: new Date().toISOString(),
  };
  const good: ArbPropGame = {
    ...base,
    props: [
      {
        player: "Player A",
        market: "batter_total_bases",
        line: 1.5,
        overPrice: 120,
        underPrice: 110,
        overBook: "DraftKings",
        underBook: "FanDuel",
      },
    ],
  };
  assert.equal(findPropArbs([good]).length, 1);

  const sameBook: ArbPropGame = {
    ...base,
    props: [{ ...good.props[0], overBook: "DraftKings", underBook: "DraftKings" }],
  };
  assert.equal(findPropArbs([sameBook]).length, 0);

  const missingBook: ArbPropGame = {
    ...base,
    props: [{ ...good.props[0], underBook: null }],
  };
  assert.equal(findPropArbs([missingBook]).length, 0);
});

test("findPropValueBets surfaces only the server-computed EV side, real-only", () => {
  const base = {
    game: "Minnesota Twins @ St. Louis Cardinals",
    sport: "mlb",
    startsAt: new Date().toISOString(),
  };
  const withEv: ArbPropGame = {
    ...base,
    props: [
      {
        player: "Player A",
        market: "batter_total_bases",
        line: 1.5,
        overPrice: 130,
        underPrice: -150,
        overBook: "DraftKings",
        underBook: "FanDuel",
        ev: 4.2,
        evSide: "Over",
        fairProb: 0.5,
        edge: 4.2,
        books: 5,
      },
    ],
  };
  const vals = findPropValueBets([withEv]);
  assert.equal(vals.length, 1);
  assert.equal(vals[0]!.label, "Over 1.5");
  assert.equal(vals[0]!.book, "DraftKings");
  assert.equal(vals[0]!.price, 130);

  // No server EV -> never surfaced (we don't recompute or fabricate value).
  const noEv: ArbPropGame = {
    ...base,
    props: [{ ...withEv.props[0], ev: null, evSide: null, fairProb: null }],
  };
  assert.equal(findPropValueBets([noEv]).length, 0);

  // Too few consensus books -> rejected.
  const thin: ArbPropGame = {
    ...base,
    props: [{ ...withEv.props[0], books: 2 }],
  };
  assert.equal(findPropValueBets([thin]).length, 0);
});

test("findGameLineValueBets needs a credible multi-book consensus", () => {
  // Only one book per side -> no trustable no-vig fair line -> nothing surfaced.
  assert.equal(
    findGameLineValueBets([
      {
        id: "g2",
        sport: "mlb",
        homeTeam: "Home",
        awayTeam: "Away",
        commenceTime: new Date().toISOString(),
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Away", price: 200, point: null, books: [{ book: "DraftKings", price: 200 }] },
              { name: "Home", price: -110, point: null, books: [{ book: "FanDuel", price: -110 }] },
            ],
          },
        ],
      },
    ]).length,
    0,
  );
});

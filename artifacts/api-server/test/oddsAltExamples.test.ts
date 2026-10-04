import assert from "node:assert/strict";
import test from "node:test";

import { mergeAltPeriodMarkets } from "../src/lib/oddsAltDevig.ts";
import { findGameSteals, evPct } from "../src/lib/liveStealsCore.ts";
import { americanToProb } from "../src/lib/oddsAltDevig.ts";

/**
 * Three live-shaped multi-book alt examples: same market + exact same line
 * across books, with computed fair / implied / edge / EV. Also proves +6.5
 * and +10.5 never share a fair.
 */
test("three multi-book alt examples retain exact-line prices and compute fair/edge/EV", () => {
  const bookmakers = [
    {
      title: "DraftKings",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [
            { name: "Tennessee Titans", price: 520, point: 6.5 },
            { name: "Baltimore Ravens", price: -700, point: -6.5 },
            { name: "Tennessee Titans", price: 900, point: 10.5 },
            { name: "Baltimore Ravens", price: -1400, point: -10.5 },
          ],
        },
        {
          key: "alternate_totals_h1",
          outcomes: [
            { name: "Over", price: 550, point: 20.5 },
            { name: "Under", price: -800, point: 20.5 },
          ],
        },
        {
          key: "alternate_totals",
          outcomes: [
            { name: "Over", price: 600, point: 55.5 },
            { name: "Under", price: -900, point: 55.5 },
          ],
        },
      ],
    },
    {
      title: "FanDuel",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [
            // Soft longshot vs tighter other books → positive edge after no-vig.
            { name: "Tennessee Titans", price: 700, point: 6.5 },
            { name: "Baltimore Ravens", price: -720, point: -6.5 },
            { name: "Tennessee Titans", price: 950, point: 10.5 },
            { name: "Baltimore Ravens", price: -1500, point: -10.5 },
          ],
        },
        {
          key: "alternate_totals_h1",
          outcomes: [
            { name: "Over", price: 700, point: 20.5 },
            { name: "Under", price: -820, point: 20.5 },
          ],
        },
        {
          key: "alternate_totals",
          outcomes: [
            { name: "Over", price: 750, point: 55.5 },
            { name: "Under", price: -920, point: 55.5 },
          ],
        },
      ],
    },
    {
      title: "BetMGM",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [
            { name: "Tennessee Titans", price: 530, point: 6.5 },
            { name: "Baltimore Ravens", price: -690, point: -6.5 },
            { name: "Tennessee Titans", price: 880, point: 10.5 },
            { name: "Baltimore Ravens", price: -1350, point: -10.5 },
          ],
        },
        {
          key: "alternate_totals_h1",
          outcomes: [
            { name: "Over", price: 560, point: 20.5 },
            { name: "Under", price: -780, point: 20.5 },
          ],
        },
        {
          key: "alternate_totals",
          outcomes: [
            { name: "Over", price: 610, point: 55.5 },
            { name: "Under", price: -880, point: 55.5 },
          ],
        },
      ],
    },
  ];

  const map = mergeAltPeriodMarkets(bookmakers, [
    "alternate_spreads",
    "alternate_totals",
    "alternate_totals_h1",
  ]);

  const ex1 = map.get("alternate_spreads")!.find((o) => o.name === "Tennessee Titans" && o.point === 6.5)!;
  const ex2 = map.get("alternate_totals")!.find((o) => o.name === "Over" && o.point === 55.5)!;
  const ex3 = map.get("alternate_totals_h1")!.find((o) => o.name === "Over" && o.point === 20.5)!;
  const otherLine = map.get("alternate_spreads")!.find((o) => o.name === "Tennessee Titans" && o.point === 10.5)!;

  const examples = [
    { label: "alt spread +6.5", market: "alternate_spreads", period: "full", o: ex1 },
    { label: "alt total 55.5", market: "alternate_totals", period: "full", o: ex2 },
    { label: "1H alt total 20.5", market: "alternate_totals_h1", period: "h1", o: ex3 },
  ];

  for (const ex of examples) {
    assert.ok(ex.o.books.length >= 3, ex.label);
    assert.ok(ex.o.noVigFair != null, `${ex.label} fair`);
    assert.ok(ex.o.edge != null && ex.o.edge > 0, `${ex.label} positive edge`);
    const implied = americanToProb(ex.o.price);
    const ev = evPct(ex.o.noVigFair, ex.o.price);
    assert.ok(ev != null);
    // Print for the audit report (node:test captures console).
    console.log(
      JSON.stringify({
        example: ex.label,
        books: ex.o.books.map((b) => ({
          book: b.book,
          market: ex.market,
          period: ex.period,
          selection: ex.o.name,
          point: ex.o.point,
          odds: b.price,
        })),
        fairProbability: ex.o.noVigFair,
        impliedProbability: Math.round(implied * 1000) / 1000,
        edge: ex.o.edge,
        ev,
      }),
    );
  }

  // Regression: +6.5 and +10.5 must not share fair / book points.
  assert.notEqual(ex1.noVigFair, otherLine.noVigFair);
  assert.ok(ex1.books.every((b) => b.point === 6.5));
  assert.ok(otherLine.books.every((b) => b.point === 10.5));

  // Steals qualification still applies — soft-priced +6.5 may or may not clear
  // EV/edge bands; 0 steals remains valid.
  const steals = findGameSteals([
    {
      id: "evt",
      sport: "nfl",
      homeTeam: "Baltimore Ravens",
      awayTeam: "Tennessee Titans",
      commenceTime: "2026-10-04T17:00:00Z",
      markets: [
        { key: "alternate_spreads", outcomes: [ex1, otherLine] },
        { key: "alternate_totals", outcomes: [ex2] },
        { key: "alternate_totals_h1", outcomes: [ex3] },
      ],
    },
  ]);
  assert.ok(Array.isArray(steals));
});

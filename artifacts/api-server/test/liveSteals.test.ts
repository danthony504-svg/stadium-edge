import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findGameSteals,
  findPropSteals,
  inStealBand,
  stealKey,
} from "../src/lib/liveStealsCore.ts";

// A minimal odds row carrying one in-band moneyline outcome with a real edge.
// `id` is the eventId — the discriminator that must keep recurring matchups
// (series games on different dates, MLB doubleheaders) from colliding.
function oddsRow(eventId: string, commenceTime: string) {
  return {
    id: eventId,
    sport: "mlb",
    homeTeam: "St. Louis Cardinals",
    awayTeam: "Minnesota Twins",
    commenceTime,
    markets: [
      {
        key: "h2h",
        outcomes: [
          // +650 underdog ML with a real +5pt de-vig edge and a believable EV.
          { name: "Minnesota Twins", price: 650, point: null, noVigFair: 0.18, edge: 5 },
        ],
      },
    ],
  };
}

test("inStealBand only accepts +500..+30000", () => {
  assert.equal(inStealBand(500), true);
  assert.equal(inStealBand(30000), true);
  assert.equal(inStealBand(499), false);
  assert.equal(inStealBand(30001), false);
  assert.equal(inStealBand(-120), false);
  assert.equal(inStealBand(null), false);
});

test("stealKey is event-scoped: same pick on different dates yields DISTINCT ids", () => {
  // The exact same matchup string + market + pick, but two different events
  // (e.g. games 2 and 3 of a series). They MUST NOT collapse to one ledger id,
  // or onConflictDoNothing would silently drop the second attempt and the
  // auto-graded W/L record would undercount.
  const day1 = findGameSteals([oddsRow("evt_game2", "2026-06-13T23:05:00Z")]);
  const day2 = findGameSteals([oddsRow("evt_game3", "2026-06-14T23:05:00Z")]);

  assert.equal(day1.length, 1);
  assert.equal(day2.length, 1);
  // Same human-facing pick, different underlying event → different ids.
  assert.equal(day1[0]!.pick, day2[0]!.pick);
  assert.equal(day1[0]!.game, day2[0]!.game);
  assert.notEqual(day1[0]!.id, day2[0]!.id);
});

test("stealKey is stable across refreshes of the SAME event (no duplicate attempts)", () => {
  // Re-surfacing the identical event must produce the identical id so refreshes
  // dedupe to one logged attempt.
  const a = findGameSteals([oddsRow("evt_game2", "2026-06-13T23:05:00Z")]);
  const b = findGameSteals([oddsRow("evt_game2", "2026-06-13T23:05:00Z")]);
  assert.equal(a[0]!.id, b[0]!.id);
});

test("stealKey direct: eventId is part of identity", () => {
  const k1 = stealKey("mlb", "evt_game2", "Moneyline", "Minnesota Twins ML");
  const k2 = stealKey("mlb", "evt_game3", "Moneyline", "Minnesota Twins ML");
  assert.notEqual(k1, k2);
});

function propGame(eventId: string) {
  return {
    eventId,
    game: "Minnesota Twins @ St. Louis Cardinals",
    sport: "mlb",
    startsAt: "2026-06-13T23:05:00Z",
    props: [
      {
        player: "Brendan Donovan",
        market: "batter_home_runs",
        line: 0.5,
        overPrice: 550,
        underPrice: -800,
        ev: 8,
        evSide: "Over" as const,
        fairProb: 0.2,
        edge: 4,
      },
    ],
  };
}

test("findPropSteals is also event-scoped: same prop on different events => distinct ids", () => {
  const a = findPropSteals([propGame("evt_game2")]);
  const b = findPropSteals([propGame("evt_game3")]);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0]!.pick, b[0]!.pick);
  assert.notEqual(a[0]!.id, b[0]!.id);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { PropPoolEntry } from "./api.ts";
import { enrichAndSortRealProps, preferredPropSide, propSimBatchLimitForLegs, rankPropPoolEntries } from "./propSelection.ts";
import { pickBestSideEntry } from "./propSideByFinalAi.ts";

const pool: PropPoolEntry[] = [
  {
    game: "A @ B",
    marketLabel: "Points",
    player: "Alpha",
    line: 20.5,
    side: "Over",
    odds: -110,
    edge: 3.2,
    marketKey: "player_points",
    sport: "nba",
  },
  {
    game: "A @ B",
    marketLabel: "Points",
    player: "Beta",
    line: 18.5,
    side: "Over",
    odds: -105,
    edge: 1.1,
    marketKey: "player_points",
    sport: "nba",
  },
];

test("preferredPropSide uses evSide when pool context is absent", () => {
  assert.equal(preferredPropSide({ evSide: "Under", over: -110, under: -110 } as any), "Under");
});

test("preferredPropSide uses Final AI when prop pool is available", () => {
  const skenesStrikeouts: PropPoolEntry[] = [
    {
      game: "Braves @ Pirates",
      marketLabel: "Strikeouts",
      player: "Paul Skenes",
      line: 6.5,
      side: "Over",
      odds: -101,
      marketKey: "pitcher_strikeouts",
      sport: "mlb",
    },
    {
      game: "Braves @ Pirates",
      marketLabel: "Strikeouts",
      player: "Paul Skenes",
      line: 6.5,
      side: "Under",
      odds: -119,
      edge: 2.5,
      marketKey: "pitcher_strikeouts",
      sport: "mlb",
    },
  ];
  const rp = {
    sport: "mlb",
    game: "Braves @ Pirates",
    startsAt: "",
    player: "Paul Skenes",
    market: "pitcher_strikeouts",
    line: 6.5,
    over: -101,
    under: -119,
    alt: false,
    evSide: "Over" as const,
    edge: null,
  };
  assert.equal(preferredPropSide(rp, skenesStrikeouts, { propPool: skenesStrikeouts }), "Under");
});

test("pickBestSideEntry prefers Final AI over closer-to-even odds", () => {
  const skenesStrikeouts: PropPoolEntry[] = [
    {
      game: "Braves @ Pirates",
      marketLabel: "Strikeouts",
      player: "Paul Skenes",
      line: 6.5,
      side: "Over",
      odds: -101,
      marketKey: "pitcher_strikeouts",
      sport: "mlb",
    },
    {
      game: "Braves @ Pirates",
      marketLabel: "Strikeouts",
      player: "Paul Skenes",
      line: 6.5,
      side: "Under",
      odds: -119,
      edge: 2.5,
      marketKey: "pitcher_strikeouts",
      sport: "mlb",
    },
  ];
  const best = pickBestSideEntry(skenesStrikeouts, { propPool: skenesStrikeouts });
  assert.equal(best.side, "Under");
});

test("rankPropPoolEntries prefers higher edge when composite ties", () => {
  const ranked = rankPropPoolEntries(pool, { propPool: pool });
  assert.equal(ranked[0]?.player, "Alpha");
});

test("propSimBatchLimitForLegs grows with leg count", () => {
  assert.equal(propSimBatchLimitForLegs(3), 18);
  assert.equal(propSimBatchLimitForLegs(15), 42);
  assert.ok(propSimBatchLimitForLegs(15) > propSimBatchLimitForLegs(3));
  assert.ok(propSimBatchLimitForLegs(25) <= 48);
});

test("enrichAndSortRealProps attaches simHitPct and sorts by selectionScore", () => {
  const realProps = [
    {
      sport: "nba",
      game: "A @ B",
      startsAt: "",
      player: "Alpha",
      market: "player_points",
      line: 20.5,
      over: -110,
      under: -110,
      alt: false,
      evSide: "Over" as const,
      edge: 3.2,
    },
    {
      sport: "nba",
      game: "A @ B",
      startsAt: "",
      player: "Beta",
      market: "player_points",
      line: 18.5,
      over: -105,
      under: -115,
      alt: false,
      evSide: "Over" as const,
      edge: 1.1,
    },
  ];
  const sims = new Map([
    ["Alpha|player_points|20.5|Over", { hitProbability: 0.62 }],
    ["Beta|player_points|18.5|Over", { hitProbability: 0.51 }],
  ]);
  const out = enrichAndSortRealProps(realProps, pool, { propPool: pool, propSimulations: sims });
  assert.equal(out[0]?.player, "Alpha");
  assert.equal((out[0] as { simHitPct?: number }).simHitPct, 62);
});

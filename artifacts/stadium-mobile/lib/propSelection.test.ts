import assert from "node:assert/strict";
import test from "node:test";
import type { PropPoolEntry } from "./api.ts";
import { enrichAndSortRealProps, preferredPropSide, propSimBatchLimitForLegs, rankPropPoolEntries } from "./propSelection.ts";

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

test("preferredPropSide uses evSide when present", () => {
  assert.equal(preferredPropSide({ evSide: "Under", over: -110, under: -110 } as any), "Under");
});

test("rankPropPoolEntries prefers higher edge when composite ties", () => {
  const sims = new Map([
    [
      "Alpha|player_points|20.5|Over",
      { hitProbability: 0.62, completedSims: 1000, simulations: 1000, failedSims: 0 },
    ],
    [
      "Beta|player_points|18.5|Over",
      { hitProbability: 0.55, completedSims: 1000, simulations: 1000, failedSims: 0 },
    ],
  ]);
  const ranked = rankPropPoolEntries(pool, { propPool: pool, propSimulations: sims });
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
    [
      "Alpha|player_points|20.5|Over",
      { hitProbability: 0.62, completedSims: 1000, simulations: 1000, failedSims: 0, confidenceScore: 70 },
    ],
    [
      "Beta|player_points|18.5|Over",
      { hitProbability: 0.51, completedSims: 1000, simulations: 1000, failedSims: 0, confidenceScore: 55 },
    ],
  ]);
  const out = enrichAndSortRealProps(realProps, pool, { propPool: pool, propSimulations: sims });
  assert.equal(out[0]?.player, "Alpha");
  assert.equal((out[0] as { simHitPct?: number }).simHitPct, 62);
});

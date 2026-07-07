import assert from "node:assert/strict";
import test from "node:test";
import type { PropPoolEntry } from "./api.ts";
import {
  collapsePropPoolByFinalAiSide,
  pickBestSideEntry,
} from "./propSideByFinalAi.ts";

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

test("pickBestSideEntry prefers Final AI over closer-to-even odds", () => {
  const opts = { propPool: skenesStrikeouts };
  const best = pickBestSideEntry(skenesStrikeouts, opts);
  assert.equal(best.side, "Under");
  assert.equal(best.edge, 2.5);
});

test("pickBestSideEntry keeps Under when book moves Over a few cents closer to even", () => {
  const moved: PropPoolEntry[] = [
    { ...skenesStrikeouts[0]!, odds: -105 },
    { ...skenesStrikeouts[1]!, odds: -115 },
  ];
  const best = pickBestSideEntry(moved, { propPool: moved });
  assert.equal(best.side, "Under");
});

test("collapsePropPoolByFinalAiSide emits one row per line with best side", () => {
  const withAltLine: PropPoolEntry[] = [
    ...skenesStrikeouts,
    {
      game: "Braves @ Pirates",
      marketLabel: "Strikeouts",
      player: "Paul Skenes",
      line: 7.5,
      side: "Over",
      odds: 120,
      marketKey: "pitcher_strikeouts",
      sport: "mlb",
    },
    {
      game: "Braves @ Pirates",
      marketLabel: "Strikeouts",
      player: "Paul Skenes",
      line: 7.5,
      side: "Under",
      odds: -150,
      edge: 0.5,
      marketKey: "pitcher_strikeouts",
      sport: "mlb",
    },
  ];
  const out = collapsePropPoolByFinalAiSide(withAltLine, { propPool: withAltLine });
  assert.equal(out.length, 2);
  const main = out.find((e) => e.line === 6.5);
  const alt = out.find((e) => e.line === 7.5);
  assert.equal(main?.side, "Under");
  assert.equal(alt?.side, "Under");
});

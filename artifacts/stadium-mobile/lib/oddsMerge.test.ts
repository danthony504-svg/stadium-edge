import assert from "node:assert/strict";
import test from "node:test";

import { mergeOddsEntries } from "./oddsMerge.ts";

test("mergeOddsEntries prefers later source on duplicate keys", () => {
  const merged = mergeOddsEntries(
    [{ sport: "mlb", game: "A @ B", market: "Alt Spread", pick: "B +1.5", odds: -110, edge: null }],
    [{ sport: "mlb", game: "A @ B", market: "Alt Spread", pick: "B +1.5", odds: -105, edge: 2.1 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.odds, -105);
  assert.equal(merged[0]?.edge, 2.1);
});

test("mergeOddsEntries accepts liveOdds as one array source (SCAN_THREW regression)", () => {
  const real = [
    { sport: "mlb", game: "A @ B", market: "Moneyline", pick: "A", odds: -120 },
  ];
  const live = [
    { sport: "mlb", game: "A @ B", market: "Moneyline", pick: "A", odds: -115 },
    { sport: "mlb", game: "C @ D", market: "Total", pick: "Over 8.5", odds: -110 },
  ];
  const evalLines = [
    { sport: "mlb", game: "A @ B", market: "Spread", pick: "A +1.5", odds: -110 },
  ];

  // Buggy call shape that produced phone SCAN_THREW.
  assert.throws(() => {
    const sources: unknown[] = [real, ...live, evalLines];
    for (const list of sources) {
      for (const _e of list as Iterable<unknown>) void _e;
    }
  }, TypeError);

  const merged = mergeOddsEntries(real, live, evalLines);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((e) => e.market === "Moneyline")?.odds, -115);
});

test("mergeOddsEntries skips non-array sources instead of throwing", () => {
  const merged = mergeOddsEntries(
    [{ sport: "nba", game: "X @ Y", market: "Moneyline", pick: "X", odds: 150 }],
    // @ts-expect-error intentional bad caller shape (old liveOdds spread)
    { sport: "nba", game: "X @ Y", market: "Moneyline", pick: "X", odds: 140 },
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.odds, 150);
});

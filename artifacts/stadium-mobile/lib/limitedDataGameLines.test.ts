import assert from "node:assert/strict";
import test from "node:test";
import { limitedDataMoneylineMetrics } from "./limitedDataGameLines.ts";

const pick = { market: "Moneyline", isProp: false, odds: -110 };

test("a strong limited-data moneyline qualifies on real no-vig market evidence", () => {
  const metrics = limitedDataMoneylineMetrics(pick, { noVigFair: 0.58, edge: 5.6 });
  assert.equal(metrics?.dataTier, "market_only");
  assert.equal(metrics?.confidencePct, 55);
  assert.equal(metrics?.grade, "C+");
  assert.ok((metrics?.evPct ?? 0) > 0);
});

test("a weak limited-data market remains rejected", () => {
  assert.equal(limitedDataMoneylineMetrics(pick, { noVigFair: 0.53, edge: 0.6 }), null);
  assert.equal(
    limitedDataMoneylineMetrics({ market: "Spread", isProp: false, odds: -110 }, { noVigFair: 0.6, edge: 7 }),
    null,
  );
});

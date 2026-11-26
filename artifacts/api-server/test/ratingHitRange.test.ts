import assert from "node:assert/strict";
import test from "node:test";
import { ratingHitRange80 } from "../src/lib/sportSim/ratingHitRange.ts";

test("within-rating noise does not become rating uncertainty", () => {
  const samples = Array.from({ length: 400 }, (_, i) => ({ hits: i % 2 ? 11 : 14, games: 25 }));
  assert.deepEqual(ratingHitRange80(samples, .5), [.5, .5]);
});

test("the corrected range retains between-rating variation with variable group sizes", () => {
  const samples = Array.from({ length: 400 }, (_, i) =>
    i % 2 ? { hits: 5, games: 25 } : { hits: 16, games: 20 });
  const [low, high] = ratingHitRange80(samples, .5);
  assert.ok(low > .11 && low < .15);
  assert.ok(high > .85 && high < .89);
  assert.deepEqual(ratingHitRange80([{ hits: 1, games: 1 }], .99), [.99, .99]);
});

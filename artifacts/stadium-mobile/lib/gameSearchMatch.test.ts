import assert from "node:assert/strict";
import test from "node:test";

import { gameMatchesQuery } from "./gameSearchMatch.ts";

test("gameMatchesQuery matches team names and vs-style queries", () => {
  const label = "New York Yankees @ Boston Red Sox";
  assert.equal(gameMatchesQuery(label, "yankees"), true);
  assert.equal(gameMatchesQuery(label, "Dodgers vs Yankees"), false);
  assert.equal(gameMatchesQuery("Los Angeles Dodgers @ New York Yankees", "Dodgers vs Yankees"), true);
  assert.equal(gameMatchesQuery("Los Angeles Dodgers @ New York Yankees", "dodgers @ yankees"), true);
  assert.equal(gameMatchesQuery(label, "Celtics"), false);
});

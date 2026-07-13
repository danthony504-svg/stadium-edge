import test from "node:test";
import assert from "node:assert/strict";
import { pickPlayerSearchResult } from "./playerSearchPick.ts";

const wnbaHit = {
  athleteId: "5208983",
  name: "Isobel Borlase",
  sport: "wnba",
  isActive: true,
};

const nbaHit = {
  athleteId: "1966",
  name: "LeBron James",
  sport: "nba",
  isActive: true,
};

test("pickPlayerSearchResult filters by sport and whole-word name match", () => {
  const hit = pickPlayerSearchResult([nbaHit, wnbaHit], "Isobel Borlase", "wnba");
  assert.equal(hit?.athleteId, "5208983");
});

test("pickPlayerSearchResult rejects wrong sport", () => {
  const hit = pickPlayerSearchResult([wnbaHit], "Isobel Borlase", "nba");
  assert.equal(hit, null);
});

test("pickPlayerSearchResult guards single-token surname-only matches", () => {
  const hit = pickPlayerSearchResult([wnbaHit], "Borlase", "wnba");
  assert.equal(hit?.athleteId, "5208983");
  const inactive = pickPlayerSearchResult([{ ...wnbaHit, isActive: false }], "Borlase", "wnba");
  assert.equal(inactive, null);
});

test("pickPlayerSearchResult rejects fuzzy substring mismatches", () => {
  const hit = pickPlayerSearchResult([wnbaHit], "Bor", "wnba");
  assert.equal(hit, null);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPropMarketKey,
  filterPicksByAskMarketConstraint,
  filterPropPoolByAskMarkets,
  parseCoachAskMarketConstraint,
  propMarketKeyAllowed,
} from "./coachAskMarketFilter.ts";

test("phone ask: rushing and passing yards → props-only rush+pass yds", () => {
  const c = parseCoachAskMarketConstraint("10 lag rushing and passing yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_yds",
    "player_rush_yds",
  ]);
});

test("phone ask: NFL rushing and receiving yards only → props-only rush+rec yds", () => {
  const c = parseCoachAskMarketConstraint(
    "5 leg NFL rushing and receiving yards only",
  );
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_reception_yds",
    "player_rush_yds",
  ]);
});

test("canonicalPropMarketKey keeps alt/period yards inside the allowlist", () => {
  assert.equal(canonicalPropMarketKey("player_rush_yds_alternate"), "player_rush_yds");
  assert.equal(canonicalPropMarketKey("player_pass_yds_h1"), "player_pass_yds");
  assert.ok(propMarketKeyAllowed("player_rush_yds_alternate", ["player_rush_yds"]));
  assert.equal(propMarketKeyAllowed("player_rush_attempts", ["player_rush_yds"]), false);
  assert.equal(propMarketKeyAllowed("player_pass_interceptions", ["player_pass_yds"]), false);
  assert.equal(propMarketKeyAllowed("player_receptions", ["player_reception_yds"]), false);
});

test("filterPropPoolByAskMarkets drops attempts/receptions/INTs when yards asked", () => {
  const allowed = parseCoachAskMarketConstraint(
    "10 lag rushing and passing yards",
  ).allowedMarketKeys;
  const pool = [
    { marketKey: "player_rush_yds", player: "Barkley" },
    { marketKey: "player_rush_yds_alternate", player: "Henry" },
    { marketKey: "player_rush_attempts", player: "Lamar" },
    { marketKey: "player_pass_yds", player: "Allen" },
    { marketKey: "player_pass_interceptions", player: "Mahomes" },
    { marketKey: "player_receptions", player: "Waller" },
  ];
  const out = filterPropPoolByAskMarkets(pool, allowed);
  assert.deepEqual(
    out.map((r) => r.marketKey).sort(),
    ["player_pass_yds", "player_rush_yds", "player_rush_yds_alternate"],
  );
});

test("filterPicksByAskMarketConstraint blocks totals and non-yards props (screenshot leak)", () => {
  const c = parseCoachAskMarketConstraint("10 lag rushing and passing yards");
  const picks = [
    { isProp: false, market: "F5 TOTAL", pick: "Under 5.5" },
    { isProp: false, market: "TOTAL", pick: "Over 8.5" },
    {
      isProp: true,
      market: "RUSH ATTEMPTS",
      propMarketKey: "player_rush_attempts",
      pick: "Lamar Under 6.5",
    },
    {
      isProp: true,
      market: "RECEPTIONS",
      propMarketKey: "player_receptions",
      pick: "Waller Over 1.5",
    },
    {
      isProp: true,
      market: "PASS INTS",
      propMarketKey: "player_pass_interceptions",
      pick: "Mahomes Over 0.5",
    },
    {
      isProp: true,
      market: "RUSH YDS",
      propMarketKey: "player_rush_yds",
      pick: "Barkley Over 75.5",
    },
    {
      isProp: true,
      market: "PASS YDS",
      propMarketKey: "player_pass_yds_alternate",
      pick: "Allen Over 249.5",
    },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.isProp));
  assert.ok(
    out.every((p) =>
      /rush_yds|pass_yds/.test(canonicalPropMarketKey(p.propMarketKey)),
    ),
  );
});

test("generic parlay ask has no market constraint", () => {
  const c = parseCoachAskMarketConstraint("5 leg NFL parlay");
  assert.equal(c.propsOnly, false);
  assert.equal(c.allowedMarketKeys, null);
});


test("rushing yards and passing TDs does not allowlist pass yards", () => {
  const c = parseCoachAskMarketConstraint("rushing yards and passing TDs");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), ["player_rush_yds"]);
});

test("passing and receiving yards allowlists both pass and reception yards", () => {
  const c = parseCoachAskMarketConstraint("passing and receiving yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_yds",
    "player_reception_yds",
  ]);
});

test("rushing, passing, and receiving yards allowlists all three", () => {
  const c = parseCoachAskMarketConstraint("rushing, passing, and receiving yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_yds",
    "player_reception_yds",
    "player_rush_yds",
  ]);
});

test("passing TDs and receiving yards does not allowlist pass yards", () => {
  const c = parseCoachAskMarketConstraint("passing TDs and receiving yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), ["player_reception_yds"]);
});

test("rush attempts and receiving yards does not allowlist rush yards", () => {
  const c = parseCoachAskMarketConstraint("rush attempts and receiving yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), ["player_reception_yds"]);
});

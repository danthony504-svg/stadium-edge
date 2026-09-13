import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPropMarketKey,
  filterPicksByAskMarketConstraint,
  filterPropPoolByAskMarkets,
  parseCoachAskMarketConstraint,
  propMarketKeyAllowed,
} from "./coachAskMarketFilter.ts";

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
  assert.equal(canonicalPropMarketKey("player_reception_yds_h1"), "player_reception_yds");
  assert.ok(propMarketKeyAllowed("player_rush_yds_alternate", ["player_rush_yds"]));
  assert.equal(
    propMarketKeyAllowed("player_rush_attempts", ["player_rush_yds"]),
    false,
  );
  assert.equal(
    propMarketKeyAllowed("player_receptions", ["player_reception_yds"]),
    false,
  );
});

test("filterPropPoolByAskMarkets drops attempts/receptions/pass when yards-only", () => {
  const allowed = parseCoachAskMarketConstraint(
    "5 leg NFL rushing and receiving yards only",
  ).allowedMarketKeys;
  const pool = [
    { marketKey: "player_rush_yds", player: "Barkley" },
    { marketKey: "player_rush_yds_alternate", player: "Henry" },
    { marketKey: "player_rush_attempts", player: "Lamar" },
    { marketKey: "player_reception_yds", player: "Olave" },
    { marketKey: "player_receptions", player: "Olave" },
    { marketKey: "player_pass_yds", player: "Allen" },
  ];
  const out = filterPropPoolByAskMarkets(pool, allowed);
  assert.deepEqual(
    out.map((r) => r.marketKey).sort(),
    ["player_reception_yds", "player_rush_yds", "player_rush_yds_alternate"],
  );
});

test("filterPicksByAskMarketConstraint blocks totals and non-yards props", () => {
  const c = parseCoachAskMarketConstraint(
    "5 leg NFL rushing and receiving yards only",
  );
  const picks = [
    { isProp: false, market: "TOTAL", pick: "Over 48.5" },
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
      pick: "Olave Under 6.5",
    },
    {
      isProp: true,
      market: "RUSH YDS",
      propMarketKey: "player_rush_yds",
      pick: "Barkley Over 75.5",
    },
    {
      isProp: true,
      market: "REC YDS",
      propMarketKey: "player_reception_yds_alternate",
      pick: "Kittle Over 45.5",
    },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.isProp));
  assert.ok(
    out.every((p) =>
      /rush_yds|reception_yds/.test(canonicalPropMarketKey(p.propMarketKey)),
    ),
  );
});

test("yards ask without only allowlists markets but does not force props-only", () => {
  const c = parseCoachAskMarketConstraint("6 leg with rushing yards");
  assert.equal(c.propsOnly, false);
  assert.deepEqual(c.allowedMarketKeys, ["player_rush_yds"]);
});

test("generic parlay ask has no market constraint", () => {
  const c = parseCoachAskMarketConstraint("5 leg NFL parlay");
  assert.equal(c.propsOnly, false);
  assert.equal(c.allowedMarketKeys, null);
});

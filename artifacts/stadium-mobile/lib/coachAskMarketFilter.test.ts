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

test("screenshot ask: nfl rushing receiving and passing props → props-only skill families", () => {
  const c = parseCoachAskMarketConstraint(
    "9 leg nfl rushing receiving and passing props",
  );
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_attempts",
    "player_pass_completions",
    "player_pass_interceptions",
    "player_pass_tds",
    "player_pass_yds",
    "player_reception_tds",
    "player_reception_yds",
    "player_receptions",
    "player_rush_attempts",
    "player_rush_tds",
    "player_rush_yds",
  ]);
});

test("skill props ask drops spreads/totals from ticket (screenshot lead-spread leak)", () => {
  const c = parseCoachAskMarketConstraint(
    "9 leg nfl rushing receiving and passing props",
  );
  const picks = [
    {
      isProp: false,
      market: "SPREAD",
      pick: "Falcons +6",
    },
    {
      isProp: false,
      market: "TOTAL",
      pick: "Over 47.5",
    },
    {
      isProp: true,
      market: "PASS TDS",
      propMarketKey: "player_pass_tds",
      pick: "Aaron Rodgers Under 1.5 Pass TDs",
    },
    {
      isProp: true,
      market: "PASS INTS",
      propMarketKey: "player_pass_interceptions",
      pick: "Patrick Mahomes Over 0.5 Pass INTs",
    },
    {
      isProp: true,
      market: "RUSH ATTEMPTS",
      propMarketKey: "player_rush_attempts",
      pick: "Lamar Jackson Under 6.5 Rush Attempts",
    },
    {
      isProp: true,
      market: "RECEPTIONS",
      propMarketKey: "player_receptions",
      pick: "Cade Otton Over 3.5 Receptions",
    },
    {
      isProp: true,
      market: "ANYTIME TD",
      propMarketKey: "player_anytime_td",
      pick: "Someone Anytime TD",
    },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 4);
  assert.ok(out.every((p) => p.isProp));
  assert.ok(!out.some((p) => /spread|total/i.test(String(p.market))));
  assert.ok(!out.some((p) => p.propMarketKey === "player_anytime_td"));
});

test("rushing props alone allowlists rush family only", () => {
  const c = parseCoachAskMarketConstraint("6 leg NFL rushing props");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_rush_attempts",
    "player_rush_tds",
    "player_rush_yds",
  ]);
});

test("props without skill words does not constrain markets", () => {
  const c = parseCoachAskMarketConstraint("9 leg nfl props");
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

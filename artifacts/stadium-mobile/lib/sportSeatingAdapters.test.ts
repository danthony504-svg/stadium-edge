import test from "node:test";
import assert from "node:assert/strict";
import {
  getSportSeatingAdapter,
  isFamilySeatable,
  isParticipantPropFamily,
  resolveMarketFamilyId,
  listSportSeatingAdapterSports,
} from "./sportSeatingAdapters.ts";

const REQUIRED = ["nfl", "ncaaf", "nba", "wnba", "mlb", "nhl", "soccer", "tennis", "ufc"];

test("adapters exist for every Coach-supported sport", () => {
  const sports = listSportSeatingAdapterSports();
  for (const s of REQUIRED) {
    assert.ok(sports.includes(s), `missing adapter ${s}`);
    const a = getSportSeatingAdapter(s);
    assert.equal(a.sport === s || (s === "ufc" && a.sport === "ufc"), true);
  }
});

test("feed-backed families seatable; unsupported stay non-seatable", () => {
  const nfl = getSportSeatingAdapter("nfl");
  assert.equal(isFamilySeatable(nfl, resolveMarketFamilyId(nfl, "player_pass_yds", { isProp: true })), true);
  assert.equal(isParticipantPropFamily(nfl, "pass_yds"), true);
  assert.equal(isFamilySeatable(nfl, "ml"), true);

  const tennis = getSportSeatingAdapter("tennis");
  assert.equal(tennis.supportsParticipantProps, false);
  assert.equal(isFamilySeatable(tennis, "aces"), false);
  assert.equal(isFamilySeatable(tennis, resolveMarketFamilyId(tennis, "Moneyline")), true);

  const ufc = getSportSeatingAdapter("ufc");
  assert.equal(isFamilySeatable(ufc, "method"), false);
  assert.equal(isFamilySeatable(ufc, resolveMarketFamilyId(ufc, "Total Rounds")), true);

  const soccer = getSportSeatingAdapter("soccer");
  assert.equal(isFamilySeatable(soccer, "cards"), false);
  assert.equal(isFamilySeatable(soccer, resolveMarketFamilyId(soccer, "player_shots", { isProp: true })), true);

  const mlb = getSportSeatingAdapter("mlb");
  assert.equal(isFamilySeatable(mlb, "walks"), false);
  assert.equal(isFamilySeatable(mlb, resolveMarketFamilyId(mlb, "batter_hits", { isProp: true })), true);
});

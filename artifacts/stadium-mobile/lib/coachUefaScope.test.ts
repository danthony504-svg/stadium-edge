import assert from "node:assert/strict";
import test from "node:test";
import { focalSportsFromText, coachBuildSports, prioritySportsForAsk } from "./chatContextPriority.ts";
import { coachBoardSportsForAsk } from "./coachPropBoardCoverage.ts";
import { resolveImmutableAskSportScope, filterPicksByAllowedSports } from "./coachAskSportScope.ts";
const all = ["nba", "nhl", "soccer", "nfl", "ncaaf"];
for (const alias of ["uefa", "UEFA football", "ucl", "Champions League", "Europa League", "Conference League"]) {
  test(`${alias}: load and recovery stay soccer-only`, () => {
    const ask = `6 leg ${alias}`;
    assert.deepEqual([...focalSportsFromText(ask)], ["soccer"]);
    assert.deepEqual(coachBuildSports(ask, 6, all), ["soccer"]);
    assert.deepEqual(coachBoardSportsForAsk(ask, 6, all), ["soccer"]);
    assert.deepEqual(prioritySportsForAsk(ask), []);
    const allowedSports = resolveImmutableAskSportScope({ askText: ask, boardSports: all });
    assert.deepEqual(allowedSports, ["soccer"]);
    const candidates = [{ sport: "nba" }, { sport: "nhl" }, { sport: "soccer" }, {}];
    assert.deepEqual(filterPicksByAllowedSports(candidates, { allowedSports }), [{ sport: "soccer" }]);
    assert.deepEqual(filterPicksByAllowedSports(candidates.slice(0, 2), { allowedSports }), []);
  });
}
test("hard sport intent survives a widened cached board", () => {
  assert.deepEqual(resolveImmutableAskSportScope({ askText: "6 leg NBA", boardSports: all }), ["nba"]);
  assert.deepEqual(resolveImmutableAskSportScope({ askText: "6 leg UEFA and NHL", boardSports: all }), ["nhl", "soccer"]);
  assert.ok(!focalSportsFromText("6 leg no UEFA").has("soccer"));
  assert.deepEqual(resolveImmutableAskSportScope({ askText: "6 leg", boardSports: all }), all);
});

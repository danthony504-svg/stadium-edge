import assert from "node:assert/strict";
import test from "node:test";
import { teamDefensePack } from "./propDefenseEvidence.ts";
import { missingRequiredOpponentEvidence } from "./footballRushDefense.ts";
import type { TeamDefense } from "./api.ts";

for (const [sport, market] of [["nba","player_points"],["wnba","player_rebounds"],
  ["ncaab","player_assists"],["nfl","player_receptions"],["ncaaf","player_reception_yds"],
  ["nhl","player_shots_on_goal"],["mlb","batter_hits"],["soccer","player_shots"]]) {
  test(`${sport}: retain exact-market evidence when the headline statistics are absent`, () => {
    const def: TeamDefense = {sport, teamId: "1", teamName: "Team", avgPointsAgainst: null,
      avgPointsFor: null, pointDifferential: null, defensive: {}, offensive: {},
      opponentMarkets: [{market, perGame: 10, sampleSize: 3, scope: "team_allowed",
        source: "ESPN completed team box scores; full game", firstGame: "2026-10-01T00:00:00Z", lastGame: "2026-10-10T00:00:00Z"}]};
    const pack = teamDefensePack(def);
    assert.ok(pack);
    assert.equal(missingRequiredOpponentEvidence({sport, market, pack}), false);
    assert.equal(missingRequiredOpponentEvidence({sport, market,
      pack: {...pack, opponentMarkets: []}}), true, "missing evidence still blocks");
    assert.equal(missingRequiredOpponentEvidence({sport, market,
      pack: {...pack, opponentMarkets: def.opponentMarkets!.map(r => ({...r, sampleSize: 2}))}}), true,
      "insufficient samples still block");
  });
}

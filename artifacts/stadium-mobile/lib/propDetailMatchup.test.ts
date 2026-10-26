import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { TeamDefense } from "./api.ts";
import { teamDefensePack, defensePackForTeam } from "./propDefenseEvidence.ts";
import { buildPropHolisticScore, scoreOpponentTendency } from "./propHolisticRecommendation.ts";

const stat = (value: number) => ({ value, displayValue: String(value) });
function defense(sport = "nfl"): TeamDefense {
  return { sport, teamId: "21", teamName: "Philadelphia Eagles", avgPointsAgainst: 125,
    avgPointsFor: 25, pointDifferential: null,
    rushDefense: { rushingYardsAllowedPerGame: 140, yardsPerRushAllowed: 5, sampleSize: 5 },
    passDefense: { passingYardsAllowedPerGame: 270, yardsPerPassAllowed: 8, sampleSize: 5 },
    defensive: { teamGamesPlayed: stat(6), sacks: stat(8), interceptions: stat(3),
      avgSteals: stat(7), avgBlocks: stat(5), avgDefensiveRebounds: stat(30),
      goalsAgainstAverage: stat(3.8), savePct: stat(.88), shotsAgainst: stat(35),
      goalsConceded: stat(18), cleanSheets: stat(1), ERA: stat(5.5), WHIP: stat(1.6) },
    offensive: { sacks: stat(12), passingAttempts: stat(150) } };
}
for (const [sport, marketKey] of [["nfl","player_rush_yds"], ["ncaaf","player_pass_yds"],
  ["nba","player_points"], ["wnba","player_points"], ["ncaab","player_points"],
  ["nhl","player_points"], ["soccer","player_shots"], ["mlb","player_hits"]]) {
  test(`${sport}: detail opponent factor matches Coach for identical evidence`, () => {
    const ctx = { sport, marketKey, propSide: "Over", footballOppDefense: teamDefensePack(defense(sport)) };
    const detail = scoreOpponentTendency(ctx);
    const coach = buildPropHolisticScore(ctx).factors.find(f => f.key === "opponentTendency");
    assert.equal(detail.score, coach?.score);
    assert.equal(detail.display, coach?.display);
    assert.notEqual(detail.score, null, "supported matchup should be populated");
  });
}
test("football chooses rush versus pass evidence and reverses direction for Under", () => {
  const pack = teamDefensePack(defense())!;
  const rush = scoreOpponentTendency({sport:"nfl", marketKey:"player_rush_yds", propSide:"Over", footballOppDefense:pack});
  const rec = scoreOpponentTendency({sport:"nfl", marketKey:"player_reception_yds", propSide:"Over", footballOppDefense:pack});
  const under = scoreOpponentTendency({sport:"nfl", marketKey:"player_rush_yds", propSide:"Under", footballOppDefense:pack});
  assert.match(rush.display!, /140/);
  assert.match(rec.display!, /270/);
  assert.ok(rush.score! > under.score!);
});
test("empty/insufficient evidence cannot manufacture matchup from generic points allowed", () => {
  const d = defense(); d.defensive = {}; d.offensive = {};
  d.rushDefense = null; d.passDefense = null;
  assert.equal(scoreOpponentTendency({sport:"nfl", marketKey:"player_rush_yds", propSide:"Over", footballOppDefense:teamDefensePack(d)}).score, null);
  d.rushDefense = { rushingYardsAllowedPerGame:140, yardsPerRushAllowed:5, sampleSize:1 };
  assert.equal(scoreOpponentTendency({sport:"nfl", marketKey:"player_rush_yds", propSide:"Over", footballOppDefense:teamDefensePack(d)}).score, null);
});
test("opponent lookup rejects unresolved/ambiguous teams and does not substitute own team", () => {
  const row = {name:"Philadelphia Eagles",def:defense()};
  assert.equal(defensePackForTeam([row], null), null);
  assert.equal(defensePackForTeam([row], "Dallas Cowboys"), null);
  assert.equal(defensePackForTeam([row,row], row.name), null);
  assert.equal(defensePackForTeam([row], row.name)?.teamName, row.name);
});
test("mapping preserves offensive sacks separately from defensive sacks", () => {
  const p = teamDefensePack(defense())!;
  assert.equal(p.sacks,8); assert.equal(p.sacksAllowed,12);
  assert.equal(p.gamesPlayed,6); assert.equal(p.rush?.sampleSize,5);
});
test("cached mapping and matchup scoring remain synchronous and inexpensive", () => {
  const d=defense(); const start=performance.now();
  for(let i=0;i<1000;i++) scoreOpponentTendency({sport:"nfl",marketKey:"player_rush_yds",propSide:"Over",footballOppDefense:teamDefensePack(d)});
  const elapsed=performance.now()-start;
  console.log(`1000 cached matchup mappings/scores: ${elapsed.toFixed(1)}ms`);
  assert.ok(elapsed<500);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeScoringGame, scoringOpportunitySignal, scoringSignalKey, type ScoringPlay, type ScoringSnapshot } from "../src/lib/footballScoringOpportunities.js";
import { buildProjectionMean } from "../src/lib/monteCarlo.js";
import { buildPropSimulationContext, sharedDistributionPartsForProp } from "../src/lib/monteCarloBuild.js";
import { cachedPropSimCtxFromContext, propSimulationContextFromCached } from "../src/lib/propSimCtxCache.js";

const play = (n: number, type = "Rush", yards = 5): ScoringPlay => ({ id: String(n), type: { text: type }, scoreValue: /Touchdown/.test(type) ? 6 : 0,
  start: { down: 1, yardsToEndzone: yards, team: { id: "1" } }, teamParticipants: [{ type: "defense", id: "2" }],
  participants: [{ type: "rusher", athlete: { id: "10" } }, { type: "passer", athlete: { id: "11" } }, { type: "receiver", athlete: { id: "12" } }, { type: "receiver", athlete: { id: "12" } }] });
const full = () => Array.from({length: 35}, (_,i) => play(i, i < 20 ? "Rush" : "Passing Touchdown", i < 5 ? 10 : 5));
test("exact IDs bind rush, target and QB pairs; duplicate receiver roles and plays count once", () => {
  const game = summarizeScoringGame("e", "2026-10-01", "1", [...full(), play(0)])!;
  assert.equal(game.offense.rush, 20); assert.equal(game.offense.pass, 15);
  assert.equal(game.players["10"]!.inside5Rush, 15);
  assert.equal(game.players["12"]!.target, 15); assert.equal(game.qbTargets["11:12"], 15);
  assert.equal(game.players["11"]!.pass, 15);
  const defense = summarizeScoringGame("e", "2026-10-01", "2", full())!;
  assert.equal(defense.defense.passTd, 15); assert.deepEqual(defense.players, {});
});
test("no-play, penalties, kneels, spikes, conversions, missing field position and missing team fail closed", () => {
  const excluded = [ { ...play(70), isPenalty: true }, { ...play(71), text: "No Play" }, { ...play(72), text: "kneels" }, { ...play(73), text: "spike" }, { ...play(74), text: "two-point" }, { ...play(75), start: undefined }, { ...play(76), start: { down: 1, yardsToEndzone: 5 } }, play(77, "Fumble Return Touchdown") ];
  const g = summarizeScoringGame("e", "2026-10-01", "1", [...full(), ...excluded])!;
  assert.equal(g.offense.rush, 20); assert.equal(g.offense.pass, 15);
  assert.equal(summarizeScoringGame("e", "x", "1", [play(1)]), null);
});
function snapshot(teamId: string, defense = false): ScoringSnapshot {
  const games = Array.from({length: 5}, (_,i) => summarizeScoringGame(String(i), `2026-10-0${5-i}`, defense ? "2" : "1", full())!);
  return { sport: "nfl", teamId, games, collectedAt: Date.now(), fingerprint: teamId };
}
const req = { sport: "nfl", market: "player_anytime_td", athleteId: "10", playerTeamId: "1", opponentTeamId: "2", player: "A", line: 0.5, side: "Over" as const };
test("missing, mismatched, thin or unsupported context never manufactures an adjustment", () => {
  const a=snapshot("1"), b=snapshot("2",true);
  assert.equal(scoringOpportunitySignal(req,a),null);
  assert.equal(scoringOpportunitySignal(req,{...a,collectedAt:Date.now()-7*60*60_000},b),null);
  assert.equal(scoringOpportunitySignal({...req, sport:"ncaaf"},a,b),null);
  assert.equal(scoringOpportunitySignal({...req, athleteId:"unknown"},a,b),null);
  for (const market of ["player_first_td","player_rush_yds","player_pass_tds_q1"]) assert.equal(scoringOpportunitySignal({...req,market},a,b),null);
  assert.equal(scoringOpportunitySignal(req,{...a,games:a.games.slice(0,2)},b),null);
});
test("NFL/NCAAF identical semantic adapter; receiving and rushing context stay bounded and explainable", () => {
  for (const sport of ["nfl","ncaaf"]) {
    const a={...snapshot("1"),sport}, b={...snapshot("2",true),sport};
    for (const r of [{...req,sport}, {...req,sport,athleteId:"12",market:"player_reception_tds"}, {...req,sport,athleteId:"11",market:"player_pass_tds"}]) {
      const s=scoringOpportunitySignal(r,a,b)!;
      assert.ok(s.multiplier >= 0.94 && s.multiplier <= 1.06);
      assert.match(s.explanation,/Completed-game RZ context/);
      assert.match(s.fingerprint,/rz1/);
    }
  }
});
test("fresh and cached simulation paths receive identical context; fingerprint invalidates cached distribution", () => {
  const signal=scoringOpportunitySignal(req,snapshot("1"),snapshot("2",true))!;
  const game={sport:"nfl",footballTdSignals:{[scoringSignalKey(req)]:signal}};
  const history={labels:["rushingTouchdowns","receivingTouchdowns"],recent:Array.from({length:5},()=>({stats:{rushingTouchdowns:"1",receivingTouchdowns:"0"}})),vsOpponent:[]};
  const fresh=buildPropSimulationContext(req,history,game)!;
  const restored=propSimulationContextFromCached(cachedPropSimCtxFromContext(fresh),req,game);
  assert.deepEqual(restored.footballTdSignal,fresh.footballTdSignal);
  assert.equal(buildProjectionMean(restored),buildProjectionMean(fresh));
  assert.notEqual(sharedDistributionPartsForProp(req,game,null).opportunityShiftFingerprint,sharedDistributionPartsForProp(req,{sport:"nfl"},null).opportunityShiftFingerprint);
});
test("TD signal moves the actual projection once, preserves cap and complements Under; absent signal is baseline", () => {
  const base={sport:"nfl",market:"player_anytime_td",line:0.5,side:"Over" as const,recentValues:[0,1,0,1,0],discrete:true};
  const mean=buildProjectionMean(base)!;
  const boosted=buildProjectionMean({...base,footballTdSignal:{multiplier:1.06,explanation:"test",fingerprint:"a"}})!;
  assert.ok(boosted>mean);
  assert.equal(boosted,buildProjectionMean({...base,side:"Under",footballTdSignal:{multiplier:1.06,explanation:"test",fingerprint:"a"}}));
  const capped=buildProjectionMean({...base,combinedPreSimMult:1.1,footballTdSignal:{multiplier:1.06,explanation:"test",fingerprint:"a"}});
  assert.equal(capped,buildProjectionMean({...base,combinedPreSimMult:1.1}));
});

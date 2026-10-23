import assert from "node:assert/strict";
import test from "node:test";
import {parseCoachAskMarketConstraint,filterPicksByAskMarketConstraint} from "./coachAskMarketFilter.ts";
import {findExactPropPoolRow} from "./propPoolIdentity.ts";
import {matchExplicitMarketLocks} from "./explicitMarketLock.ts";
import {balancePropsByGame} from "./api.ts";
import {mergePropSimWithLocal,localPropSimulation,enrichPropSimResults} from "./simulatorLocalSim.ts";
for(const sport of ["nfl","ncaaf","nba","wnba","ncaab","mlb","nhl","soccer","tennis","ufc"]){
 test(`${sport}: explicit full-game scope rejects prop/period recovery and overrides prior props`,()=>{
  const c=parseCoachAskMarketConstraint(`Build a 4-leg ${sport} parlay for tomorrow using full-game spreads, moneylines, and totals.`,["player props only"]);
  assert.equal(c.gameLinesOnly,true);assert.equal(c.propsOnly,false);
  const rows=[{isProp:false,market:"Moneyline",pick:"Home"},{isProp:false,market:"Total",pick:"Under 50.5"},{isProp:false,market:"Q1 Total",pick:"Under 10.5"},{isProp:false,market:"spreads_h1",pick:"Home -2.5"},{isProp:true,market:"Points",pick:"Player Over 9.5"}];
  assert.deepEqual(filterPicksByAskMarketConstraint(rows,c),rows.slice(0,2));
 });
 test(`${sport}: exact identity rejects missing and conflicting event/athlete/sport`,()=>{
  const row={sport,player:"Player",side:"Over",line:9.5,marketKey:"player_points",game:"A @ B",athleteId:"a",eventId:"e"};
  const pick={...row,propSide:"Over",propLine:9.5,propMarketKey:"player_points"};
  assert.equal(findExactPropPoolRow(pick,[row]),row);
  for(const key of ["sport","athleteId","eventId"] as const){assert.equal(findExactPropPoolRow(pick,[{...row,[key]:undefined}]),undefined);assert.equal(findExactPropPoolRow(pick,[{...row,[key]:"foreign"}]),undefined);}
 });
}
test("milestone union survives context caps with real null-line quotes",()=>{
 const ask="Find NBA double-double and triple-double picks for tomorrow";
 assert.deepEqual(matchExplicitMarketLocks(ask)!.allowedMarketKeys.sort(),["player_double_double","player_triple_double"]);
 const base={sport:"nba",game:"A @ B",startsAt:"2026-10-24T20:00Z",player:"Player",line:null,over:870,under:null,alt:false};
 const rows=[...Array.from({length:100},(_,i)=>({...base,player:`Other ${i}`,market:"player_points",line:9.5})),{...base,market:"player_double_double"},{...base,market:"player_triple_double"}];
 assert.deepEqual(balancePropsByGame(rows,8,ask).map(p=>[p.market,p.line,p.over]),[["player_double_double",null,870],["player_triple_double",null,870]]);
});
test("failed milestone rows with no fallback cannot retain simulated/cached badges",()=>{
 const server={key:"stale",player:"Player",market:"player_double_double",line:.5,side:"Over" as const,simulations:10000,cached:true,sampleGames:3,hitProbability:null,mostLikelyLine:null,meanProjection:null,medianProjection:null,confidenceScore:null,stdDev:null,percentiles:null,nullReason:"insufficient_sample" as const,tier:"deep" as const};
 const merged=mergePropSimWithLocal(server,null)!;
 assert.equal(merged.simulations,0);assert.equal(merged.cached,false);assert.equal(merged.hitProbability,null);assert.deepEqual(enrichPropSimResults([server],{})[0],merged);
});
test("valid empirical milestone fallback remains available but never claims 10k draws",()=>{
 const hist={labels:["PTS","REB","AST","STL","BLK"],recent:Array.from({length:10},(_,i)=>({stats:{PTS:"20",REB:i%2?"10":"9",AST:"4",STL:"0",BLK:"0"}}))};
 const local=localPropSimulation(hist,{player:"Player",market:"player_double_double",line:.5,side:"Over"})!;
 const row=mergePropSimWithLocal(null,local)!;assert.equal(row.simulations,0);assert.ok(Math.abs(row.hitProbability!-.46)<1e-12);
});

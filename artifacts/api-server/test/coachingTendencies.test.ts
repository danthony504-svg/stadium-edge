import assert from "node:assert/strict";
import test from "node:test";
import { basketballCallStudy, parseBasketballStudy, footballCallStudy, readCoachingStudy } from "../src/lib/coachingTendencies.js";
import { summarizeScoringGame } from "../src/lib/footballScoringOpportunities.js";
const date=new Date(Date.now()-86400_000).toISOString();
function box(id="100", team="2") {return {header:{id,competitions:[{status:{type:{completed:true}},competitors:[{team:{id:team}}]}]},boxscore:{players:[{team:{id:team},statistics:[{labels:["MIN","FG","3PT"],athletes:Array.from({length:5},(_,i)=>({athlete:{id:String(i+10)},stats:["48","4-10","1-3"]}))}]}]}};}
test("basketball exact completed identity, shares and all basketball leagues",()=>{
 for(const sport of ["nba","wnba","ncaab"]) {
 const games=["100","101","102"].map(id=>parseBasketballStudy(id,date,"2",box(id),sport)!);
 const s=basketballCallStudy(sport,"2",games)!;
 assert.equal(s.mode,"shadow");assert.equal(s.metrics.threePointAttemptRate,.3);assert.equal(s.players[0]!.shotAttemptShare,.2);assert.equal(s.players[0]!.minutesPerGame,48);assert.ok(s.unavailable.includes("pick_and_roll"));
 }
});
test("missing/partial/foreign/duplicate player box fails closed",()=>{
 assert.equal(parseBasketballStudy("999",date,"2",box()),null);
 assert.equal(parseBasketballStudy("100",date,"3",box()),null);
 const partial=box();partial.boxscore.players[0]!.statistics[0]!.athletes.pop();assert.equal(parseBasketballStudy("100",date,"2",partial),null);
 const duplicate=box();duplicate.boxscore.players[0]!.statistics[0]!.athletes[1]!.athlete.id="10";assert.equal(parseBasketballStudy("100",date,"2",duplicate),null);
 const pre=box();pre.header.competitions[0]!.status.type.completed=false;assert.equal(parseBasketballStudy("100",date,"2",pre),null);
});
test("three distinct past games required",()=>{
 const g=parseBasketballStudy("100",date,"2",box())!;
 assert.equal(basketballCallStudy("nba","2",[g,g,g]),null);
 assert.equal(basketballCallStudy("nfl","2",[g,g,g]),null);
 assert.equal(basketballCallStudy("nba","2",[{...g,date:"2999-01-01"},g]),null);
});
test("football all-field calls separate from red-zone usage",()=>{
 const plays=Array.from({length:40},(_,i)=>({id:String(i),type:{text:i<30?"Rush":"Pass Incompletion"},start:{down:i<20?1:3,yardsToEndzone:60,team:{id:"2"}},teamParticipants:[{id:"3",type:"defense"}]}));
 const g=summarizeScoringGame("100",date,"2",plays)!;
 assert.equal(g.calls!.rush,30);assert.equal(g.offense.rush,0);
 for(const sport of ["nfl","ncaaf"]) {
 const snapshot={sport,teamId:"2",collectedAt:Date.now(),fingerprint:"x",games:[g,{...g,eventId:"101"},{...g,eventId:"102"}]};
 const s=footballCallStudy(snapshot)!;assert.equal(s.metrics.passAttemptShare,.25);assert.equal(s.metrics.earlyDownPassAttemptShare,0);assert.ok(s.unavailable.includes("neutral_score_adjustment"));
 assert.equal(footballCallStudy({...snapshot,games:[g,g,g]}),null);
 }
});
test("cache miss never fetches provider",async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("unexpected work");};
 try {assert.equal(await readCoachingStudy("nba","999999"),null);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});

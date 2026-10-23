import assert from "node:assert/strict";
import test from "node:test";
import {runNcaafFullGameCandidate,type FullGameCandidateInput} from "../src/lib/sportSim/ncaafFullGameCandidate.js";
import {runNcaafCandidate} from "../src/lib/sportSim/ncaafCandidate.js";
const input:FullGameCandidateInput={home:{ptsFor:28,ptsAgainst:21,games:8},away:{ptsFor:28,ptsAgainst:21,games:8},seed:719,forecastAt:"2026-10-22T18:00:00Z",kickoff:"2026-10-24T18:00:00Z",ruleset:"fixture",overtimeHistory:Array.from({length:30},(_,i)=>({gameId:String(i),ruleset:"fixture",completedAt:"2025-10-01T18:00:00Z",observedAt:"2025-10-01T19:00:00Z",regulationHome:21,regulationAway:21,finalHome:i%2?28:24,finalAway:i%2?24:28}))};
test("full-game candidate resolves only ties from paired observed OT evidence",()=>{
 const original=Math.random,reg=runNcaafCandidate(input)!,full=runNcaafFullGameCandidate(input)!;
 for(let i=0;i<full.draws;i++){assert.notEqual(full.homeScores[i],full.awayScores[i]);if(reg.homeScores[i]!==reg.awayScores[i]){assert.equal(full.homeScores[i],reg.homeScores[i]);assert.equal(full.awayScores[i],reg.awayScores[i]);}else assert.deepEqual([full.homeScores[i]!-reg.homeScores[i]!,full.awayScores[i]!-reg.awayScores[i]!].sort((a,b)=>a-b),[3,7]);}
 assert.equal(Math.random,original);assert.equal(full.productionReady,false);assert.deepEqual(full,runNcaafFullGameCandidate({...input,overtimeHistory:[...input.overtimeHistory].reverse()}));
});
test("missing, padded, future and conflicting OT evidence fail closed",()=>{
 assert.equal(runNcaafFullGameCandidate({...input,overtimeHistory:[]}),null);
 assert.equal(runNcaafFullGameCandidate({...input,overtimeHistory:Array(30).fill(input.overtimeHistory[0])}),null);
 for(const patch of [{observedAt:input.forecastAt},{regulationAway:20},{finalHome:20},{finalHome:NaN},{ruleset:"other"}])assert.equal(runNcaafFullGameCandidate({...input,overtimeHistory:[{...input.overtimeHistory[0]!,...patch},...input.overtimeHistory.slice(1)]}),null);
 assert.equal(runNcaafFullGameCandidate({...input,overtimeHistory:[...input.overtimeHistory,{...input.overtimeHistory[0]!,finalHome:30}]}),null);
});

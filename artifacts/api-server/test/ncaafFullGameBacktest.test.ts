import assert from "node:assert/strict";
import test from "node:test";
import {runFullGameReplay,readFullGameReplayArchive,priorRegulationTeamSample,type TimedGame,type FullGameReplayArchive} from "../src/lib/ncaafFullGameBacktest.js";
const game=(id:number,day:number,year=2024):TimedGame=>({eventId:String(id),season:year,homeId:"1",awayId:"2",kickoff:`${year}-08-${String(day).padStart(2,"0")}T18:00:00Z`,completedAt:`${year}-08-${String(day).padStart(2,"0")}T22:00:00Z`,observedAt:`${year}-08-${String(day).padStart(2,"0")}T23:00:00Z`,homePoints:28,awayPoints:21,overtime:false,source:"synthetic-test",ruleset:"fixture"});
function fixture():FullGameReplayArchive{
 return {version:1,games:[game(1,1),game(2,8),game(3,15),{...game(99,23),homePoints:31,awayPoints:21},...Array.from({length:30},(_,i)=>({...game(1000+i,1,2023),homeId:"3",awayId:"4",homePoints:i%2?28:24,awayPoints:i%2?24:28,overtime:true,regulationHomePoints:21,regulationAwayPoints:21}))],forecasts:[{season:2024,eventId:"99",forecastAt:"2024-08-23T16:00:00Z",inputCutoffAt:"2024-08-23T15:00:00Z",injurySourceTimestamp:"2024-08-22T18:00:00Z",ruleset:"fixture"}],quotes:[{season:2024,eventId:"99",bookmaker:"Test",market:"spread",line:-10,firstPrice:-110,secondPrice:-110,observedAt:"2024-08-23T14:00:00Z",settlement:"full_game_including_overtime"},{season:2024,eventId:"99",bookmaker:"Test",market:"ml",line:null,firstPrice:-150,secondPrice:130,observedAt:"2024-08-23T14:00:00Z",settlement:"full_game_including_overtime"}]};
}
test("full-game replay binds exact quotes, separates pushes, pairs market Brier and stays unreleased",()=>{
 const a=fixture(),r=runFullGameReplay(a);assert.equal(r.scored,1);assert.equal(r.productionReady,false);
 const spread=r.cohorts.find(c=>c.market==="spread")!,ml=r.cohorts.find(c=>c.market==="ml")!;
 assert.equal(spread.games,0);assert.equal(spread.pushes,1);assert.equal(spread.modelBrier,null);assert.equal(ml.games,1);assert.ok(Math.abs(ml.marketBrier!-(.6/(.6+100/230)-1)**2)<1e-12);
 assert.deepEqual(r,runFullGameReplay({...a,games:[...a.games].reverse()}));
});
test("target scores and late-observed prior games cannot leak into forecasts",()=>{
 const a=fixture(),target=a.games.find(g=>g.eventId==="99")!,f=a.forecasts[0]!;
 assert.deepEqual(priorRegulationTeamSample([...a.games,{...game(12,20),observedAt:"2024-08-23T17:00:00Z",homePoints:80}],target,f,"1"),{games:3,ptsFor:28,ptsAgainst:21});
 const p=runFullGameReplay(a).predictions[0]!,changed=runFullGameReplay({...a,games:a.games.map(g=>g.eventId==="99"?{...g,homePoints:70,awayPoints:0}:g)}).predictions[0]!;
 assert.equal(p.homeMean,changed.homeMean);assert.equal(p.awayMean,changed.awayMean);
});
test("missing evidence withholds, orphan or conflicting quotes reject, duplicates add no votes",()=>{
 const a=fixture();assert.equal(runFullGameReplay({...a,games:a.games.filter(g=>g.season!==2023)}).excluded.insufficientOvertimeEvidence,1);
 assert.equal(runFullGameReplay({...a,forecasts:[{...a.forecasts[0]!,injurySourceTimestamp:null}]}).excluded.missingInjuryEvidence,1);
 assert.throws(()=>readFullGameReplayArchive({...a,quotes:[...a.quotes,{...a.quotes[0]!,line:-9.5}]}),/ambiguous_quote/);
 assert.throws(()=>readFullGameReplayArchive({...a,quotes:[{...a.quotes[0]!,observedAt:"2024-08-23T17:00:00Z"}]}),/invalid_quote/);
 assert.equal(readFullGameReplayArchive({...a,quotes:[...a.quotes,...a.quotes]}).quotes.length,2);
});

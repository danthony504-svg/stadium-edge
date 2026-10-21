import assert from 'node:assert/strict';
import test from 'node:test';
import {priorTeamSample,readBacktestGames,runNcaafBacktest} from '../src/lib/ncaafBacktest.js';
import type {CfbdGame} from '../src/lib/cfbdHistory.js';
const game=(id:number,day:number):CfbdGame=>({eventId:String(id),season:2024,kickoff:new Date(Date.UTC(2024,8,day)).toISOString(),homeId:'1',awayId:'2',homePoints:28,awayPoints:21,overtime:false});
test('future, same-day, other-season, OT and unknown results excluded from samples',()=>{
 const target=game(9,29),prior=[game(1,1),game(2,8),game(3,15)];
 const excluded=[game(4,29),game(5,30),{...game(6,22),overtime:true},{...game(7,22),overtime:null},{...game(8,22),season:2025}];
 assert.deepEqual(priorTeamSample([...prior,...excluded,target],target,'1'),{games:3,ptsFor:28,ptsAgainst:21});
 assert.equal(priorTeamSample(prior.slice(0,2),target,'1'),null);
});
test('deduplicates identical games and rejects conflicting results',()=>{
 const g=game(1,1),s={year:2024,week:1,games:[g]};assert.equal(readBacktestGames([s,s]).length,1);
 assert.throws(()=>readBacktestGames([s,{...s,games:[{...g,homePoints:29}]}]),/conflicting/);
 assert.throws(()=>readBacktestGames([{...s,games:[{...g,kickoff:'bad'}]}]),/invalid_game/);
});
test('reports exclusions and deterministic errors, never production readiness',()=>{
 const games=[game(1,1),game(2,8),game(3,15),game(4,22),{...game(5,29),overtime:true},{...game(6,30),overtime:null}];
 const report=runNcaafBacktest(games);assert.deepEqual(report,runNcaafBacktest(games));
 assert.equal(report.productionReady,false);assert.equal(report.validationReady,false);
 assert.equal(report.reports[0]!.scored,1);assert.equal(report.reports[0]!.excluded.thinHistory,3);
 assert.equal(report.reports[0]!.excluded.overtime,1);assert.equal(report.reports[0]!.excluded.unknownOvertime,1);
 assert.equal(report.reports[0]!.totalMAE,0);
});

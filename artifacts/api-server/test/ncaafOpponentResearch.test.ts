import test from 'node:test';
import assert from 'node:assert/strict';
import type {CfbdGame} from '../src/lib/cfbdHistory.js';
import {opponentScoreMeans,runOpponentDevelopment} from '../src/lib/ncaafOpponentResearch.js';
const game=(id:number,day:number,homeId='1',awayId='2',homePoints=28,awayPoints=21):CfbdGame=>({eventId:String(id),season:2024,kickoff:new Date(Date.UTC(2024,8,day)).toISOString(),homeId,awayId,homePoints,awayPoints,overtime:false});
const history=[game(1,1),game(2,8),game(3,15)],target=game(4,22);
test('opponent model ignores target results, future, other-season and OT rows',()=>{
 const base=opponentScoreMeans(history,target);
 const bad=[{...target,homePoints:84},game(9,29),{...game(10,16),season:2025},{...game(11,16),overtime:true},{...game(12,16),overtime:null}];
 assert.deepEqual(opponentScoreMeans([...history,...bad],target),base);
 assert.deepEqual(opponentScoreMeans([...history].reverse(),target),base);
 assert.equal(opponentScoreMeans(history.slice(0,2),target),null);
});
test('balanced synthetic schedule distinguishes offenses and opponent defenses',()=>{
 const rows:CfbdGame[]=[];let id=1;
 const attack=[10,0,-10,0],defense=[-5,0,5,0];
 for(let round=0;round<3;round++)for(let h=0;h<4;h++)for(let a=h+1;a<4;a++)rows.push(game(id++,1+round*7,String(h+1),String(a+1),30+attack[h]!+defense[a]!,30+attack[a]!+defense[h]!));
 const strong=opponentScoreMeans(rows,game(99,29,'1','2'))!;
 const weak=opponentScoreMeans(rows,game(100,29,'3','2'))!;
 assert.ok(strong.home>weak.home+8);assert.ok(strong.away<weak.away);
});
test('development uses identical cohorts and ignores all 2025 changes',()=>{
 const rows=[...history,target];const r=runOpponentDevelopment(rows,[]);
 assert.equal(r.pairedGames,1);assert.equal(r.excluded.thinHistory,3);
 assert.deepEqual(r,runOpponentDevelopment([...rows,{...game(99,29),season:2025,homePoints:84}],[]));
 assert.equal(r.productionReady,false);assert.equal(r.validationReady,false);assert.equal(r.season,2024);
});

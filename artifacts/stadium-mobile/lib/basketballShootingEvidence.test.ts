import test from 'node:test';import assert from 'node:assert/strict';
import {basketballShootingEvidence as evidence} from './basketballShootingEvidence.ts';
const games=(stats:Record<string,string>)=>Array.from({length:3},()=>({stats}));
test('derive weighted efficiency and misses from posted pairs',()=>{assert.match(evidence(games({FG:'4-10'}))[0]!,/12\/30 \(40.0%\); 18 misses/);});
test('explicit machine fields work, missing attempts never become zero',()=>{assert.equal(evidence(games({fieldGoalsMade:'4'})).length,0);assert.match(evidence(games({fieldGoalsMade:'4',fieldGoalsAttempted:'10'}))[0]!,/18 misses/);});
test('conflicting aliases, invalid counts and thin samples remain unknown',()=>{for(const stats of [{FG:'4-10',FGM:'5',FGA:'10'},{FG:'11-10'},{FG:'--'},{FG:'-1-10'}])assert.equal(evidence(games(stats)).length,0);assert.equal(evidence(games({FG:'4-10'}).slice(0,2)).length,0);});
test('zero attempts have no fabricated percentage; three-point/FT kept separate',()=>{assert.match(evidence(games({FG:'0-0'}))[0]!,/percentage unavailable/);assert.equal(evidence(games({FG:'4-10','3PT':'1-4',FT:'2-3'})).length,3);});

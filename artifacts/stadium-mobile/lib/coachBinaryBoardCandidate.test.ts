import test from 'node:test';
import assert from 'node:assert/strict';
import {parsedPickFromPoolEntry} from './propSelection.ts';
import {isRealisticBoardPropCandidate} from './boardPropSimExpansion.ts';
import type {PropPoolEntry} from './api.ts';
const row=(marketKey:string,side:string,line:number|null=null)=>({player:'Verified player',game:'Away @ Home',marketKey,marketLabel:marketKey,side,line,odds:150,sport:'nfl',athleteId:'1',eventId:'2'} as PropPoolEntry);
for(const market of ['player_anytime_td','player_double_double','player_goal_scorer_anytime']) {
 test(`${market} binary Yes/No reaches candidate evaluation without changing source price`,()=>{
  const source=row(market,'Yes');const yes=parsedPickFromPoolEntry(source);
  assert.equal(yes.propLine,0.5);assert.equal(yes.propSide,'Over');assert.equal(yes.odds,150);
  assert.equal(source.line,null);assert.equal(isRealisticBoardPropCandidate(yes),true);
  assert.equal(parsedPickFromPoolEntry(row(market,'No')).propSide,'Under');
 });
}
test('missing point on a continuous market remains ineligible',()=>{
 assert.equal(isRealisticBoardPropCandidate(parsedPickFromPoolEntry(row('player_pass_yds','Over'))),false);
});
test('posted binary alternate threshold is preserved',()=>{
 assert.equal(parsedPickFromPoolEntry(row('player_anytime_td','Over',1.5)).propLine,1.5);
});

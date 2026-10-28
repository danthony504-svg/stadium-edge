import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEvidenceSides } from './playerMatchupContext.ts';
import { explainMatchup } from './matchupEvidence.ts';
const team = (teamId: string, name: string, sport='nba') => ({teamId,name,sport,location:null,abbrev:null,league:'',logo:null});
const teams=[team('a','Portland Trail Blazers'),team('b','Los Angeles Lakers')];
test('explicit player team binds opposing defense for either side',()=>{
 assert.equal(resolveEvidenceSides('nba','a',teams[0].name,teams[1].name,teams)?.opponent.teamId,'b');
 assert.equal(resolveEvidenceSides('nba','b',teams[0].name,teams[1].name,teams)?.isHome,true);
});
test('missing, wrong, nickname-only, ambiguous and cross-sport identity fail closed',()=>{
 for(const id of [null,'wrong']) assert.equal(resolveEvidenceSides('nba',id,teams[0].name,teams[1].name,teams),null);
 assert.equal(resolveEvidenceSides('nba','a','Blazers',teams[1].name,teams),null);
 assert.equal(resolveEvidenceSides('nba','a',teams[0].name,teams[1].name,[...teams,team('c',teams[1].name)]),null);
 assert.equal(resolveEvidenceSides('nfl','a',teams[0].name,teams[1].name,teams),null);
});
test('descriptive Player Props/Coach evidence does not invent a simulation or home split',()=>{
 const e=explainMatchup({sport:'nba',athleteId:null,market:'player_points',line:10,side:'Over',startsAt:'2026-11-01T00:00Z',opponentName:'Opponent'});
 assert.ok(e.cautions.some(s=>s.includes('descriptive')));
 assert.ok(!e.cautions.some(s=>s.includes('n=undefined')));
 assert.equal(e.observations.length,0);
});

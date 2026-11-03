import test from 'node:test';
import assert from 'node:assert/strict';
import {propPoolFromPlayerProps,attachPickScores} from './pickScoreContext.ts';
import type {PlayerProp} from './api.ts';
import type {ParsedPick} from './pickCardModel.ts';
const source:PlayerProp={player:'Center',market:'player_points',line:17.5,overPrice:140,underPrice:-180,alt:false,headshot:null,athleteId:'C',playerTeamId:'H',position:'C',eventId:'E',overBook:'Book',underBook:'Book'};
const pool=propPoolFromPlayerProps([source],'Away @ Home','nba',{homeTeamId:'H',awayTeamId:'A'},'E');
const pick:ParsedPick={game:'Away @ Home',market:'Points',pick:'Center Over 17.5 Points',odds:140,sport:'nba',isProp:true,player:'Center',athleteId:'C',eventId:'E',propMarketKey:'player_points',propLine:17.5,propSide:'Over'};
test('Coach pool preserves both priced sides and verified roster/team identity',()=>{
 assert.deepEqual(pool.map(p=>p.side),['Over','Under']);
 assert.ok(pool.every(p=>p.position==='C'&&p.playerTeamId==='H'));
});
test('Coach scoring carries exact-market roster evidence without borrowing another athlete or market',()=>{
 const scored=attachPickScores([pick],{propPool:pool})[0]!;
 assert.equal(scored.rosterPosition,'C');assert.equal(scored.playerTeamId,'H');
 for(const patch of [{athleteId:'OTHER'},{eventId:'OTHER'},{propMarketKey:'player_assists'}]){
  const rejected=attachPickScores([{...pick,...patch}],{propPool:pool})[0]!;
  assert.equal(rejected.rosterPosition,undefined);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {teamDefensePack} from './propDefenseEvidence.ts';
import {shouldDropPropMissingOppDefense,multiSportOppDefenseTilt} from './footballRushDefense.ts';
import {marketDefenseContext} from './matchupEvidence.ts';
import type {TeamDefense} from './api.ts';
const d:TeamDefense={sport:'nhl',teamId:'D',teamName:'Defender',avgPointsAgainst:null,avgPointsFor:null,pointDifferential:null,defensive:{shotsAgainst:{value:800,displayValue:'800'}},offensive:{},shotAllowance:{shotsAllowedPerGame:24,sampleSize:5,firstGame:'2026-10-01',lastGame:'2026-10-20',source:'completed boxes'}};
test('verified per-game rate replaces legacy season total and appears in explanation',()=>{assert.equal(teamDefensePack(d)?.shotsAgainst,24);assert.match(marketDefenseContext('nhl','player_shots_on_goal','Defender',d)!,/24.0.*n=5/);assert.equal(teamDefensePack({...d,shotAllowance:null})?.shotsAgainst,null);});
test('Coach rejects either shot side without observed opponent sample',()=>{for(const side of ['Over','Under']){const o={sport:'nhl',market:'player_shots_on_goal',side,line:1.5};assert.equal(shouldDropPropMissingOppDefense({...o,pack:teamDefensePack({...d,shotAllowance:null})}),true);assert.equal(shouldDropPropMissingOppDefense({...o,pack:teamDefensePack(d)}),false);}});

test('opponent suppression and permissiveness change Over/Under tendency in opposite directions',()=>{for(const [shots,sign] of [[24,-1],[34,1]]){const pack={shotsAgainst:shots,shotsAgainstSample:5};const over=multiSportOppDefenseTilt({sport:'nhl',market:'player_shots_on_goal',side:'Over',pack});const under=multiSportOppDefenseTilt({sport:'nhl',market:'player_shots_on_goal',side:'Under',pack});assert.equal(Math.sign(over.tilt),sign);assert.equal(Math.sign(under.tilt),-sign);}});

test('future or unbound opponent evidence cannot explain this pregame selection',()=>{assert.equal(marketDefenseContext('nhl','player_shots_on_goal','Defender',d,Date.parse('2026-10-15')),null);assert.equal(marketDefenseContext('nba','player_shots_on_goal','Defender',d),null);});

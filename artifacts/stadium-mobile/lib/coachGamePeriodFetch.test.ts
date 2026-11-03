import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSlateGameSimulationsWithStatus} from './coachGameMonteCarlo.ts';

test('full-game simulation does not wait for irrelevant team period fetches; NBA period queries retain them', async t => {
 const requests: {url:string,body:any}[]=[];
 t.mock.method(globalThis,'fetch',async (url:any,init:any) => {
   requests.push({url:String(url),body:init?.body ? JSON.parse(init.body):null});
   return new Response('null',{status:200,headers:{'content-type':'application/json'}});
 });
 const game='Audit Away @ Audit Home';
 const ids=new Map([[game,{sport:'nba',homeTeamId:'audit-home',awayTeamId:'audit-away',homeTeam:'Audit Home',awayTeam:'Audit Away'}]]);
 await fetchSlateGameSimulationsWithStatus(new Map([[game,[{sport:'nba',game,market:'Moneyline',pick:'Audit Home',odds:-110}]]]),ids);
 assert.equal(requests.filter(r=>r.url.includes('team-period-stats')).length,0);
 assert.equal(requests.find(r=>r.url.includes('game-outcome'))?.body.simulations,10000);
 requests.length=0;
 await fetchSlateGameSimulationsWithStatus(new Map([[game,[{sport:'nba',game,market:'Q1 Spread',pick:'Audit Home -2.5',odds:-110}]]]),ids);
 assert.equal(requests.filter(r=>r.url.includes('team-period-stats')).length,2);
});

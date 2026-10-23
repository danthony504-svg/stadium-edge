import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {recoveryPlan,recoverOvertime} from './ncaaf-recover-overtime.mjs';
const now='2026-10-23T23:00:00.000Z';
function payload(ot=true){return {header:{id:'99',league:{slug:'college-football'},season:{year:2026},competitions:[{
  date:'2026-09-05T19:30:00Z',status:{type:{state:'post',completed:true}},competitors:[
    {homeAway:'home',team:{id:'1'},score:ot?'28':'21',linescores:[7,7,7,0,...(ot?[7]:[])].map(value=>({value}))},
    {homeAway:'away',team:{id:'2'},score:ot?'24':'14',linescores:[7,7,0,ot?7:0,...(ot?[3]:[])].map(value=>({value}))}
  ]}]}};}
test('recovery has explicit finite event/season budgets and rejects duplicates',()=>{
  assert.deepEqual(recoveryPlan(2026,['99'],now),{season:2026,events:['99'],maximumRequests:1,paidOddsRequests:0,automaticUnlock:false});
  for(const ids of [[],['99','99'],['../99'],['99?token=x'],Array.from({length:33},(_,i)=>String(i))])
    assert.throws(()=>recoveryPlan(2026,ids,now),/invalid_events/);
  assert.throws(()=>recoveryPlan(2027,['99'],now),/invalid_season/);
});
test('authentic receipt and original raw bytes remain recoverable without historical availability claims',()=>{
  const raw=JSON.stringify(payload()),a=recoverOvertime(raw,'99',2026,now,now);
  assert.equal(a.rawResponse,raw);
  assert.equal(a.sha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(a.games[0].observedAt,now);
  assert.equal(a.games[0].completedAt,now);
  assert.equal(a.games[0].actualCompletedAt,null);
  assert.equal(a.games[0].regulationHomePoints,21);
  assert.equal(a.games[0].regulationAwayPoints,21);
  assert.equal(a.games[0].rulesetCompatibilityVerified,false);
  assert.equal(a.historicalAvailabilityVerified,false);
  assert.equal(a.automaticUnlock,false);
});
test('non-OT, unfinished, wrong-season and conflicting box scores cannot enter OT recovery',()=>{
  assert.throws(()=>recoverOvertime(JSON.stringify(payload(false)),'99',2026,now,now),/not_verified_overtime/);
  for(const mutate of [p=>p.header.competitions[0].status.type.completed=false,
      p=>p.header.competitions[0].competitors[0].score='80']){
    const p=payload();mutate(p);assert.throws(()=>recoverOvertime(JSON.stringify(p),'99',2026,now,now));
  }
  assert.throws(()=>recoverOvertime(JSON.stringify(payload()),'99',2025,now,now),/identity/);
  assert.throws(()=>recoverOvertime(JSON.stringify(payload()),'98',2026,now,now),/identity/);
});
test('default recovery command does not connect to the database or fetch source data',()=>{
  const result=JSON.parse(execFileSync(process.execPath,['scripts/ncaaf-recover-overtime.mjs','--season','2026','--events','99'],
    {encoding:'utf8',env:{...process.env,DATABASE_URL:'invalid://must-not-connect'}}));
  assert.equal(result.planOnly,true);assert.equal(result.maximumRequests,1);assert.equal(result.paidOddsRequests,0);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildInjuryArchive,usableBeforeKickoff} from './ncaaf-capture-injuries.mjs';
const raw=JSON.stringify({injuries:[{displayName:'Team A',injuries:[]}]});
const start='2026-10-23T10:00:00Z',end='2026-10-23T10:00:05Z';
test('uses receipt time, not request start, to prevent pregame leakage',()=>{
 const a=buildInjuryArchive(raw,start,end);
 assert.equal(usableBeforeKickoff(a,'2026-10-23T10:00:03Z'),false);
 assert.equal(usableBeforeKickoff(a,end),false);
 assert.equal(usableBeforeKickoff(a,'2026-10-23T10:01:00Z'),true);
 assert.equal(usableBeforeKickoff(a,'2024-10-19T16:00:00Z'),false);
});
test('preserves raw evidence and unknown coverage without backfill',()=>{
 const a=buildInjuryArchive(raw,start,end);
 assert.equal(a.rawResponse,raw);assert.equal(a.absentTeamStatus,'unknown');
 assert.equal(a.historicalBackfillAllowed,false);assert.equal(a.teamCount,1);
 assert.equal(a.sha256.length,64);
});
test('rejects malformed responses, duplicate teams and reversed timestamps',()=>{
 assert.throws(()=>buildInjuryArchive('{}',start,end));
 assert.throws(()=>buildInjuryArchive(raw,end,start));
 assert.throws(()=>buildInjuryArchive(JSON.stringify({injuries:[{displayName:'A',injuries:[]},{displayName:'A',injuries:[]}]}),start,end));
});

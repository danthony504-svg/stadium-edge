import test from 'node:test';import assert from 'node:assert/strict';
import {positionThresholdHistory} from '../src/lib/positionThresholdHistory.js';
const box=(i:number)=>({header:{id:String(i),competitions:[{date:`2026-01-0${i}`,status:{type:{completed:true}},competitors:[{team:{id:'home'}},{team:{id:'away'}}]}]},boxscore:{players:[{team:{id:'away'},statistics:[{labels:['MIN','PTS','3PT'],athletes:[{athlete:{id:'1',position:{abbreviation:'PG'}},stats:['30','20','5-9']},{athlete:{id:'2',position:{abbreviation:'SG'}},stats:['30','20','6-10']},{athlete:{id:'3',position:{abbreviation:'C'}},stats:['30','10','0-1']}]}]}]}});
test('two guards clearing a threshold still count once per game; made threes are explicit',()=>{
 const r=positionThresholdHistory([box(1),box(2),box(3),box(3)],'home',Date.parse('2026-02-01')).find(r=>r.position==='G'&&r.market==='player_threes')!;
 assert.equal(r.games.length,3);assert.deepEqual(r.games[0]!.values,[5,6]);assert.equal(r.games.filter(g=>g.values.some(v=>v>4.5)).length,3);
});
test('unknown positions and missing stats cannot count as defensive stops',()=>{
 const b=box(3);b.boxscore.players[0]!.statistics[0]!.athletes[0]!.athlete.position.abbreviation='UNKNOWN';
 assert.equal(positionThresholdHistory([box(1),box(2),b],'home').length,0);
 const m=box(3);m.boxscore.players[0]!.statistics[0]!.athletes[0]!.stats[2]='';
 assert.equal(positionThresholdHistory([box(1),box(2),m],'home').some(r=>r.market==='player_threes'),false);
});
test('future wrong-team and unfinished games never enter denominators',()=>{
 const b=box(3);b.header.competitions[0]!.status.type.completed=false;
 assert.equal(positionThresholdHistory([box(1),box(2),b],'home').length,0);
 assert.equal(positionThresholdHistory([box(1),box(2),box(3)],'foreign').length,0);
 assert.equal(positionThresholdHistory([box(1),box(2),box(3)],'home',Date.parse('2025-01-01')).length,0);
});

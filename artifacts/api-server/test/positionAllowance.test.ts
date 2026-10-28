import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregatePositionAllowances, type AllowanceBox} from '../src/lib/positionAllowance.ts';
function box(n:number,patch:Partial<AllowanceBox>={}):AllowanceBox{return {header:{id:String(n),competitions:[{date:`2026-10-${20+n}T00:00:00Z`,status:{type:{completed:true}},competitors:[{team:{id:'DEF'}},{team:{id:'OFF'}}]}]},boxscore:{players:[{team:{id:'OFF'},statistics:[{labels:['MIN','PTS','REB','AST','BLK','STL'],athletes:[{athlete:{id:'C1',position:{abbreviation:'C'}},stats:['24','12','8','2','1','0']},{athlete:{id:'PG1',position:{abbreviation:'PG'}},stats:['36','30','3','10','0','2']}]}]}]},...patch};}
test('opposing verified primary positions; pooled minutes and real games, not team totals',()=>{
 const rows=aggregatePositionAllowances([box(1),box(2),box(3)],'DEF',Date.parse('2026-10-28'));
 const c=rows.find(r=>r.position==='C'&&r.market==='player_points')!;
 assert.equal(c.per36,18);assert.equal(c.games,3);assert.equal(c.appearances,3);assert.equal(c.minutes,72);
 assert.equal(rows.find(r=>r.position==='PG'&&r.market==='player_assists')?.per36,10);
 assert.equal(rows.find(r=>r.position==='C'&&r.market==='player_steals')?.per36,0);
});
test('duplicates, wrong defending team, future/live games and ambiguous positions fail closed',()=>{
 const now=Date.parse('2026-10-28');
 assert.equal(aggregatePositionAllowances([box(1),box(1),box(2)],'DEF',now).length,0);
 assert.equal(aggregatePositionAllowances([box(1),box(2),box(3)],'OTHER',now).length,0);
 const a=box(3);a.header!.competitions![0]!.status!.type!.completed=false;
 assert.equal(aggregatePositionAllowances([box(1),box(2),a],'DEF',now).length,0);
 assert.equal(aggregatePositionAllowances([box(1),box(2),box(3)],'DEF',Date.parse('2026-10-22')).length,0);
 const boxes=[box(1),box(2),box(3)];
 for(const b of boxes)b.boxscore!.players![0]!.statistics![0]!.athletes![0]!.athlete!.position!.abbreviation='F/C';
 assert.ok(!aggregatePositionAllowances(boxes,'DEF',now).some(r=>r.position==='C'));
});
test('duplicate athlete groups cannot inflate counts; missing stats are not zero',()=>{
 const boxes=[box(1),box(2),box(3)];
 for(const b of boxes){const g=b.boxscore!.players![0]!.statistics![0]!;g.athletes![0]!.stats![2]='';b.boxscore!.players![0]!.statistics!.push(g);}
 const rows=aggregatePositionAllowances(boxes,'DEF',Date.parse('2026-10-28'));
 assert.equal(rows.find(r=>r.position==='C'&&r.market==='player_points')?.appearances,3);
 assert.ok(!rows.some(r=>r.position==='C'&&r.market==='player_rebounds'));
});

import test from 'node:test';import assert from 'node:assert/strict';
import {daysSinceLatestLoggedFight as days} from '../src/lib/fightPickAnalysis.ts';
const now=Date.parse('2026-10-29T12:00:00Z');
const fight=(date:string|null,result:'W'|'L'|'D'|null='W')=>({date,result,opponent:'Verified opponent',method:'Decision'});
test('latest completed fight selected independently of ordering, calendar days only',()=>{
 assert.equal(days([fight('2026-10-01'),fight('2026-10-20')],now),9);
 assert.equal(days([fight('2026-10-20'),fight('2026-10-01')],now),9);
});
test('missing, invalid, yearless and future dates cannot establish latest completed fight',()=>{
 for(const date of [null,'unknown','October 20','2027-01-01'])assert.equal(days([fight('2026-10-20'),fight(date)],now),null);
 assert.equal(days([],now),null);assert.equal(days([fight('2026-10-20')],NaN),null);
});
test('uncompleted events do not establish layoff; same UTC day is zero',()=>{
 assert.equal(days([fight('2026-10-29T01:00:00Z')],now),0);
 assert.equal(days([fight('2026-10-20'),fight('2027-01-01',null)],now),9);
});

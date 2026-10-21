import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMarketLines,readBaselineQuotes} from '../src/lib/ncaafMarketBaseline.js';
import type {CfbdGame} from '../src/lib/cfbdHistory.js';
const g:CfbdGame={season:2024,eventId:'1',homeId:'1',awayId:'2',homePoints:28,awayPoints:21,kickoff:'2024-09-01T00:00:00Z',overtime:false};
const q={season:2024,eventId:'1',provider:'Book A',total:49,homeSpread:-7};
test('home spread sign and paired errors use identical game subsets',()=>{
 const rows=compareMarketLines([{game:g,total:53,margin:10}],[q,{...q,eventId:'2'},{...q,season:2025}],2024);
 assert.deepEqual(rows[0],{provider:'Book A',total:{pairedGames:1,modelMAE:4,bookMAE:0,modelMinusBookMAE:4},margin:{pairedGames:1,modelMAE:3,bookMAE:0,modelMinusBookMAE:3}});
});
test('missing fields are excluded independently; books never pooled',()=>{
 const rows=compareMarketLines([{game:g,total:53,margin:10}],[{...q,total:null},{...q,provider:'Book B',homeSpread:null}],2024);
 assert.equal(rows.length,2);assert.equal(rows[0]!.total.pairedGames,0);assert.equal(rows[0]!.total.bookMAE,null);
 assert.equal(rows[0]!.margin.pairedGames,1);assert.equal(rows[1]!.margin.pairedGames,0);
});
test('identical quotes dedupe; ambiguous lines, orphan IDs and invalid values fail',()=>{
 const s={year:2024,games:[g],quotes:[q,q]};assert.equal(readBaselineQuotes([s,s]).length,1);
 assert.throws(()=>readBaselineQuotes([{...s,quotes:[q,{...q,total:50}]}]),/ambiguous_book_line/);
 assert.throws(()=>readBaselineQuotes([{...s,quotes:[{...q,eventId:'9'}]}]),/invalid_quote/);
 assert.throws(()=>readBaselineQuotes([{...s,quotes:[{...q,total:'49'}]}]),/invalid_quote/);
});

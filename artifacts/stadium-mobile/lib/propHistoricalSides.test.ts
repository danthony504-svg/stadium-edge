import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalSides} from './propHistoricalSides.ts';
test('all numerical prop markets keep pushes separate from either winning side',()=>{
 for(const line of [0,1,3,10,251]) assert.deepEqual(historicalSides([line-1,line,line+1,NaN],line),{total:3,over:1,under:1,pushes:1});
});
test('half lines have strict complementary sides without pushes',()=>assert.deepEqual(historicalSides([1,2,3],1.5),{total:3,over:2,under:1,pushes:0}));

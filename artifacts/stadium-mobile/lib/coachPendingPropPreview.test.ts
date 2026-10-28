import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingPropPreview} from './coachPendingPropPreview.ts';
const games=Array.from({length:7},()=>({isProp:false}));
test('pending mixed game-only preview cannot trigger seven-leg early completion',()=>{
 assert.equal(pendingPropPreview(games,7,true,true).length,6);
 assert.equal(games.length,7);
});
test('qualified props permit early completion without adding filler',()=>{
 const mixed=[...games.slice(0,6),{isProp:true}];
 assert.deepEqual(pendingPropPreview(mixed,7,true,true),mixed);
});
test('finished prop scan and explicit game-only asks retain all qualified game lines',()=>{
 assert.deepEqual(pendingPropPreview(games,7,false,true),games);
 assert.deepEqual(pendingPropPreview(games,7,true,false),games);
});
test('short provisional buffers remain short',()=>{
 assert.equal(pendingPropPreview(games.slice(0,3),7,true,true).length,3);
});

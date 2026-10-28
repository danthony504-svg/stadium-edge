import test from 'node:test';import assert from 'node:assert/strict';import {opponentMarketAllowance} from '../src/lib/loadOpponentMarketAllowance.ts';
test('cold Coach call does not await source work; overlapping warm request shares it',async()=>{
 const original=globalThis.fetch;let finish!:(r:Response)=>void;let calls=0;
 globalThis.fetch=(async()=>{calls++;return new Promise<Response>(r=>{finish=r;});}) as typeof fetch;
 try{
  assert.deepEqual(await opponentMarketAllowance('nba','warm-fixture-unique',false),[]);
  const waiting=opponentMarketAllowance('nba','warm-fixture-unique',true);
  for(let i=0;i<20&&!finish;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(finish,'source work starts in background');assert.equal(calls,1);
  finish(new Response(JSON.stringify({events:[]}),{status:200}));assert.deepEqual(await waiting,[]);
  assert.deepEqual(await opponentMarketAllowance('nba','warm-fixture-unique',false),[]);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

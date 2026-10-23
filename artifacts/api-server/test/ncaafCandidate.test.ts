import assert from "node:assert/strict";
import test from "node:test";
import {performance} from "node:perf_hooks";
import {candidateDriveRates,chooseSampleMean,runNcaafCandidate} from "../src/lib/sportSim/ncaafCandidate.js";
const input={home:{ptsFor:28,ptsAgainst:17,games:8},away:{ptsFor:20,ptsAgainst:19,games:8},seed:12345};
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
test("rates recover per-game expectations without ordinary scoring caps",()=>{
 for(const ppg of [0,7,14,21,28,35,42,56,70,84]){const r=candidateDriveRates(ppg/12)!;assert.ok(r.td>=0&&r.fg>=0&&r.td+r.fg<=1+1e-12);assert.ok(Math.abs(r.expectedPoints*12-ppg)<1e-9);}
 assert.ok(candidateDriveRates(3)!.td>candidateDriveRates(2)!.td);assert.equal(candidateDriveRates(NaN),null);
});
test("10k draws recover supplied means",()=>{const s=runNcaafCandidate(input)!;assert.equal(s.draws,10000);assert.equal(s.settlement,"regulation_only");assert.ok(Math.abs(mean(s.homeScores)-s.homeMean)<.7);assert.ok(Math.abs(mean(s.awayScores)-s.awayMean)<.7);});
test("offensive/QB proxy shocks move cover at least two percentage points",()=>{
 const base=runNcaafCandidate(input)!,up=runNcaafCandidate({...input,home:{...input.home,ptsFor:31}})!,down=runNcaafCandidate({...input,home:{...input.home,ptsFor:22}})!;
 const cover=(s:typeof base)=>s.homeScores.filter((v,i)=>v-s.awayScores[i]!>3.5).length/s.draws;
 assert.ok(cover(up)-cover(base)>=.02);assert.ok(cover(base)-cover(down)>=.02);
});
test("thin inputs fail; sparse venue splits use larger sample",()=>{
 assert.equal(runNcaafCandidate({...input,home:{...input.home,games:1}}),null);assert.equal(runNcaafCandidate({...input,simulations:100}),null);
 assert.deepEqual(chooseSampleMean({venue:{games:1,ptsFor:70,ptsAgainst:3},overall:{games:8,ptsFor:28,ptsAgainst:20}}),{games:8,ptsFor:28,ptsAgainst:20});
 assert.equal(chooseSampleMean({overall:{games:2,ptsFor:28,ptsAgainst:20}}),null);
});
test("seeded candidate reproducible without global RNG mutation",()=>{const rng=Math.random;assert.deepEqual(runNcaafCandidate(input),runNcaafCandidate(input));assert.equal(Math.random,rng);});
test("report 10k CPU cost, zero network",()=>{const start=performance.now();assert.ok(runNcaafCandidate(input));console.log(`NCAAF candidate 10000 draws: ${(performance.now()-start).toFixed(2)}ms`);});

test("non-integer and non-finite sample counts are not real history",()=>{
 for(const games of [NaN,Infinity,3.5,-1]){assert.equal(runNcaafCandidate({...input,home:{...input.home,games}}),null);assert.equal(chooseSampleMean({overall:{ptsFor:28,ptsAgainst:21,games}}),null);}
});

import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlight } from "../src/lib/singleFlight.js";

test("concurrent cache misses share one fetch; different keys remain parallel", async () => {
 const run=createSingleFlight(); let calls=0; let release!:()=>void;
 const wait=new Promise<void>(resolve=>release=resolve);
 const reads=Array.from({length:100},()=>run("same",async()=>{calls++;await wait;return "real";}));
 assert.equal(await run("other",async()=>"independent"),"independent");
 assert.equal(calls,1); release();
 assert.ok((await Promise.all(reads)).every(x=>x==="real"));
 assert.equal(await run("same",async()=>"fresh"),"fresh");
});
test("failure clears in-flight state and allows a later retry", async () => {
 const run=createSingleFlight();
 await assert.rejects(()=>run("key",async()=>{throw Error("provider down");}),/provider down/);
 assert.equal(await run("key",async()=>42),42);
});

import test from "node:test";
import assert from "node:assert/strict";
import { propsBrowseDeadline } from "./propsBrowseDeadline.ts";

test("hanging transport settles and aborts its child instead of retaining skeletons", async () => {
 let child: AbortSignal | undefined;
 await assert.rejects(propsBrowseDeadline(signal => { child=signal; return new Promise(() => {}); }, undefined, 15), /Player props request timed out/);
 assert.equal(child?.aborted,true);
});
test("sport switch cancellation settles even if transport ignores abort", async () => {
 const parent=new AbortController(); let child: AbortSignal | undefined;
 const result=propsBrowseDeadline(signal=>{ child=signal; return new Promise(()=>{}); },parent.signal,1000);
 await Promise.resolve(); parent.abort();
 await assert.rejects(result,{name:"AbortError"}); assert.equal(child?.aborted,true);
});
test("a stalled game does not discard another game's posted props", async () => {
 const pages=await Promise.all([
 propsBrowseDeadline(async()=>({props:[{line:21.5}]}),undefined,100),
 propsBrowseDeadline(()=>new Promise(()=>{}),undefined,15).catch(()=>null)
 ]);
 assert.deepEqual(pages.filter(Boolean),[{props:[{line:21.5}]}]);
});

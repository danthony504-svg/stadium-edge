import test from "node:test";
import assert from "node:assert/strict";
import {parseDepthChartEvidence,warmDepthChartEvidence} from "../src/lib/preparedDepthCharts.ts";
const raw=()=>({team:{id:"18"},season:{year:2026},timestamp:"2026-10-25T06:00:00Z",depthchart:[{id:"offense",positions:{qb:{athletes:[{id:"101"},{id:"102"}]}}}]});
test("reported depth order is bound to team and season, never confirmed role",()=>{
 const x=parseDepthChartEvidence(raw(),"18",2026,Date.now())!;
 assert.deepEqual(x.players.map(p=>p.depthOrder),[1,2]);
 assert.equal(x.publishedAt,null);assert.equal(x.roleProjectionValidated,false);
 assert.match(x.sourceSha256,/^[a-f0-9]{64}$/);
 assert.equal(parseDepthChartEvidence(raw(),"19",2026,Date.now()),null);
 assert.equal(parseDepthChartEvidence(raw(),"18",2025,Date.now()),null);
});
test("ambiguous depth order remains unknown",()=>{
 const x=raw();x.depthchart[0].positions.qb.athletes[1].id="101";
 assert.equal(parseDepthChartEvidence(x,"18",2026,Date.now()),null);
});
test("warm captures real response time separately; invalid identity never passes",async()=>{
 const prev=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify(raw()));};
 try {const x=await warmDepthChartEvidence("18",2026);assert.ok(x);assert.equal(calls,1);assert.equal(x.publishedAt,null);
 assert.equal(await warmDepthChartEvidence("wrong",2026),null);assert.equal(calls,1);
 } finally {globalThis.fetch=prev;}
});

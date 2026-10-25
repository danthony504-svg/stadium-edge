import test from "node:test";
import assert from "node:assert/strict";
import { catchUpNcaafDevelopment } from "../src/lib/ncaafDevelopmentCatchup.js";
function fixture(pointer: unknown = null, receivedAt = "2026-10-24T14:01:00Z", now = "2026-10-24T14:15:00Z") {
  const calls: { name: string; args: string[] }[] = [];
  const db = { query: async (sql: string) => {
    if (sql.includes("current_database")) return {rows:[{name:"stadium_edge_production"}]};
    if (sql.includes("clock_timestamp")) return {rows:[{now}]};
    if (sql.includes("WHERE key=$1")) return {rows:pointer ? [{value:pointer}] : []};
    if (sql.includes("WHERE key LIKE")) return {rows:[{value:{version:1,researchOnly:true,odds:{receivedAt},matched:[{target:{eventId:"101",season:2026,kickoff:"2026-10-24T23:00:00Z"}}]}}]};
    throw Error("unexpected query");
  }};
  return { db, calls, loadFrozen: async () => pointer ? ({artifact:{excludedGameIds:["2026:99"]},pointer:{}} as never) : null, runCollector: async (name: string, args: string[]) => { calls.push({name,args}); } };
}
test("new development targets get a free same-slot catch-up without another odds request", async () => {
  const f = fixture();
  const r = await catchUpNcaafDevelopment(f);
  assert.equal(r.state,"processed");
  assert.deepEqual(f.calls,[
    {name:"ncaaf-conference-availability.mjs",args:["--capture-slot","2026-10-24T14:00:00.000Z","--development-catchup"]},
    {name:"ncaaf-repair-team-history.mjs",args:["--season","2026","--capture-slot","2026-10-24T14:00:00.000Z"]},
    {name:"ncaaf-capture-usage.mjs",args:["--capture-slot","2026-10-24T14:00:00.000Z"]},
    {name:"ncaaf-context-dataset.mjs",args:[]},
  ]);
  assert.equal(r.releaseEligible,false);
});
test("a frozen candidate permits prospective catch-up but does not fit or request odds", async () => {
  const f=fixture({state:"frozen_research_candidate"});
  const r=await catchUpNcaafDevelopment(f);
  assert.equal(r.state,"processed");assert.equal(r.contextRole,"holdout_context");
  assert.equal(f.calls.length,4);
  assert.ok(f.calls.every(c=>!c.name.includes("live-inputs") && !c.name.includes("adjusted")));
});
test("overnight receipt reuses its active slot without borrowing the next budget",async()=>{
 const same=fixture(null,"2026-10-24T02:01:00Z","2026-10-24T12:00:00Z");
 assert.equal((await catchUpNcaafDevelopment(same)).state,"processed");
 assert.equal(same.calls[0].args[1],"2026-10-24T02:00:00.000Z");
 const crossed=fixture(null,"2026-10-24T13:59:00Z","2026-10-24T14:15:00Z");
 assert.equal((await catchUpNcaafDevelopment(crossed)).state,"waiting_for_active_slot_inputs");
 assert.equal(crossed.calls.length,0);
});
test("stale or future live slates cannot start catch-up", async () => {
  for (const receivedAt of ["2026-10-24T01:00:00Z","2026-10-24T15:00:00Z","invalid"]) {
    const f=fixture(null,receivedAt);
    assert.equal((await catchUpNcaafDevelopment(f)).state,"waiting_for_current_inputs");
    assert.deepEqual(f.calls,[]);
  }
});
test("protocol-excluded games never start holdout catch-up",async()=>{
 const f=fixture({state:"frozen_research_candidate"});
 f.loadFrozen=async()=>({artifact:{excludedGameIds:["2026:101"]},pointer:{}} as never);
 assert.equal((await catchUpNcaafDevelopment(f)).state,"waiting_for_upcoming_targets");
 assert.equal(f.calls.length,0);
});
test("invalid frozen registry fails before collector writes",async()=>{
 const f=fixture({state:"invalid"});
 f.loadFrozen=async()=>{throw Error("adjusted_invalid_registry_pointer");};
 await assert.rejects(()=>catchUpNcaafDevelopment(f),/invalid_registry/);
 assert.equal(f.calls.length,0);
});

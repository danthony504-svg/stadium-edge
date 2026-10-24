import test from "node:test";
import assert from "node:assert/strict";
import { catchUpNcaafDevelopment } from "../src/lib/ncaafDevelopmentCatchup.js";
function fixture(pointer: unknown = null, receivedAt = "2026-10-24T14:01:00Z", now = "2026-10-24T14:15:00Z") {
  const calls: { name: string; args: string[] }[] = [];
  const db = { query: async (sql: string) => {
    if (sql.includes("current_database")) return {rows:[{name:"stadium_edge_production"}]};
    if (sql.includes("clock_timestamp")) return {rows:[{now}]};
    if (sql.includes("WHERE key=$1")) return {rows:pointer ? [{value:pointer}] : []};
    if (sql.includes("WHERE key LIKE")) return {rows:[{value:{version:1,researchOnly:true,odds:{receivedAt},matched:[{target:{season:2026,kickoff:"2026-10-24T23:00:00Z"}}]}}]};
    throw Error("unexpected query");
  }};
  return { db, calls, runCollector: async (name: string, args: string[]) => { calls.push({name,args}); } };
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
test("a frozen candidate stops development catch-up before any collector or outcome access", async () => {
  const f = fixture({state:"frozen_research_candidate"});
  assert.equal((await catchUpNcaafDevelopment(f)).state,"skipped_frozen_candidate");
  assert.deepEqual(f.calls,[]);
});
test("stale or future live slates cannot start catch-up", async () => {
  for (const receivedAt of ["2026-10-24T02:00:00Z","2026-10-24T15:00:00Z","invalid"]) {
    const f=fixture(null,receivedAt);
    assert.equal((await catchUpNcaafDevelopment(f)).state,"waiting_for_current_inputs");
    assert.deepEqual(f.calls,[]);
  }
});


test("overnight active archives remain usable past six hours without changing their budget slot", async () => {
  const f=fixture(null,"2026-10-24T02:01:00Z","2026-10-24T10:15:00Z");
  assert.equal((await catchUpNcaafDevelopment(f)).state,"processed");
  for(const c of f.calls.filter(x=>x.args.includes("--capture-slot")))
    assert.equal(c.args[c.args.indexOf("--capture-slot")+1],"2026-10-24T02:00:00.000Z");
});
test("a prior-slot archive never spends the new slot's evidence budget", async () => {
  const f=fixture(null,"2026-10-24T13:59:00Z","2026-10-24T14:15:00Z");
  assert.equal((await catchUpNcaafDevelopment(f)).state,"waiting_for_current_inputs");
  assert.deepEqual(f.calls,[]);
});

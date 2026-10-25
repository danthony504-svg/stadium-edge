import test from "node:test";
import assert from "node:assert/strict";
import {summarizeResearchLedger,type LedgerRow} from "../src/lib/ncaafResearchLedger.ts";
const registry={modelVersion:"frozen:abc",frozenAt:"2026-10-24T00:00:00Z",excludedGameIds:["2026:9"]};
const row=(patch:Partial<LedgerRow>={}):LedgerRow=>({season:"2026",eventId:"1",modelVersion:"frozen:abc",role:"independent_holdout",forecastAt:"2026-10-24T01:00:00Z",recordedAt:"2026-10-24T01:00:01Z",kickoff:"2026-10-24T02:00:00Z",settlementLinked:false,development:false,...patch});
const now="2026-10-25T00:00:00Z";
test("duplicate quote/forecast rows do not multiply distinct games",()=>{
 const report=summarizeResearchLedger([row(),row({settlementLinked:true})],registry,now);
 assert.equal(report.cohorts[0].distinctProspectiveGames,1);
 assert.equal(report.cohorts[0].settlementLinkedGames,1);
 assert.equal(report.qualifiedHoldoutGames,null);assert.equal(report.releaseEligible,false);
});
test("training, protocol exclusions, legacy models and retrospective writes never count",()=>{
 const report=summarizeResearchLedger([row({development:true}),row({eventId:"9"}),row({modelVersion:"old"}),row({recordedAt:row().kickoff}),row({forecastAt:"2026-10-23T00:00:00Z"}),row({recordedAt:"bad"})],registry,now);
 assert.equal(report.cohorts.length,0);
 assert.equal(report.excludedReasons.development_or_excluded_game,2);
 assert.equal(report.excludedReasons.invalid_prospective_timing,3);
});
test("season cohorts are separate and never infer authentication from settlement links",()=>{
 const report=summarizeResearchLedger([row(),row({season:"2025"})],registry,now,true);
 assert.deepEqual(report.cohorts.map(c=>c.season),[2025,2026]);
 assert.equal(report.truncated,true);assert.equal(report.qualifiedHoldoutGames,null);
 assert.equal(summarizeResearchLedger([row()],null,now).cohorts.length,0);
 assert.throws(()=>summarizeResearchLedger([],registry,"bad"),/invalid_clock/);
});

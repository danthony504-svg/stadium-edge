import test from "node:test";
import assert from "node:assert/strict";
import {auditNcaafForecasts,type NcaafForecast} from "../src/lib/ncaafValidation.js";
const row:NcaafForecast={eventId:"1",season:2025,market:"spread",quoteId:"provider-outcome-1",book:"fixture-only",line:-3.5,selection:"home",sourceUrl:"https://example.com/fixture",predictedAt:"2025-10-01T12:00Z",historyCutoff:"2025-10-01T11:00Z",kickoff:"2025-10-01T18:00Z",settledAt:"2025-10-01T22:00Z",prediction:.7,marketProbability:.5,outcome:1,modelVersion:"test-only",settlement:"full_game"};
test("audit metrics use exact forecasts and do not approve production",()=>{const a=auditNcaafForecasts([row]);assert.equal(a.accepted,1);assert.ok(Math.abs(a.candidate!.brier-.09)<1e-9);assert.equal(a.marketBaseline!.brier,.25);assert.equal(a.productionReady,false);});
test("reject leakage, duplicate forecasts, absent quote and settlement mismatch",()=>{
 const a=auditNcaafForecasts([row,row,{...row,eventId:"2",historyCutoff:"2025-10-02T00:00Z"},{...row,eventId:"3",line:null},{...row,eventId:"4",settlement:"regulation_only"},{...row,eventId:"5",quoteId:""}]);
 assert.equal(a.accepted,1);for(const key of ["duplicate_forecast","time_leakage_or_missing_time","missing_exact_line","regulation_candidate_not_full_game","missing_provenance"])assert.equal(a.rejected[key],1);
});
test("empty journal and pushes cannot masquerade as validation",()=>{const a=auditNcaafForecasts([{...row,outcome:null}]);assert.equal(a.candidate,null);assert.ok(a.blockers.includes("no_usable_frozen_forecasts"));assert.equal(a.rejected.push_or_void,1);});

import test from "node:test";
import assert from "node:assert/strict";
import { dailyCoachPicksReady } from "../src/lib/dailyCoachNotification.ts";
const now = Date.parse("2026-10-19T16:00:00Z");
function row() {
 const pick = { game: "Away @ Home", market: "moneyline", pick: "Home", odds: 100,
 startsAt: new Date(now+3600000).toISOString(),
 finalAiScore: { grade: "B", confidencePct: 65, edgePct: 15, simHit: 0.65 } };
 return { fresh: true, deepSimComplete: true, computedAt: new Date(now-60000).toISOString(),
 snapshot: { boardScan: { picks: [pick, {...pick, game: "Other @ Match"}] } } } as any;
}
test("fresh simulated qualifying upcoming picks permit alert", () => assert.equal(dailyCoachPicksReady(row(),now),true));
test("empty, stale, incomplete, future timestamps fail closed", () => {
 for(const patch of [{snapshot:null},{fresh:false},{deepSimComplete:false},{computedAt:new Date(now-16*60000).toISOString()},{computedAt:new Date(now+1).toISOString()}])
 assert.equal(dailyCoachPicksReady({...row(),...patch},now),false);
});
test("past games, invalid prices and below-floor grades never announce ready", () => {
 for(const patch of [{startsAt:new Date(now-1).toISOString()},{odds:0},{finalAiScore:{grade:"C",confidencePct:65,edgePct:15,simHit:0.65}},{finalAiScore:{grade:"B",confidencePct:40,edgePct:15,simHit:0.65}}]){
 const r=row(); r.snapshot.boardScan.picks=r.snapshot.boardScan.picks.map((p:any)=>({...p,...patch}));
 assert.equal(dailyCoachPicksReady(r,now),false);
 }
});

import test from "node:test";
import assert from "node:assert/strict";
import { canCompleteAutomaticSmallTicket, isAutomaticFreeCoachAsk, runScanUntilTargetSatisfied } from "./coachSmallTicketCompletion.ts";
import { AUTO_FREE_COACH_ASK, freeCoachAskForStyle } from "./coachAutoFreePreview.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
const picks = ["Spread","Total"].map(market => ({isProp:false,sport:"nba",market,pick:market === "Spread" ? "Team +1.5" : "Over 220.5",odds:-110,finalAiScore:{grade:"B+",confidencePct:65,edgePct:10,simHit:0.7}} as ParsedPick));
test("only automatic free templates enable the two-leg early path",()=>{
  assert.equal(isAutomaticFreeCoachAsk(AUTO_FREE_COACH_ASK),true);
  for(const style of ["hot","easy","value","longshot"] as const) assert.equal(isAutomaticFreeCoachAsk(freeCoachAskForStyle(style)),true);
  assert.equal(isAutomaticFreeCoachAsk("2 leg NFL"),false);
});
test("complete requires exact count, variety, normal qualification and completed required slots",()=>{
  const base={enabled:true,target:2,picks};assert.equal(canCompleteAutomaticSmallTicket(base),true);
  assert.equal(canCompleteAutomaticSmallTicket({...base,picks:[picks[0]!,{...picks[0]!,market:"Alt Spread"}]}),false);
  for(const patch of [{enabled:false},{target:3},{picks:picks.slice(0,1)},{awaitingPropSlots:true},{propPhaseIncomplete:true},{picks:[picks[0]!,picks[0]!]}]) assert.equal(canCompleteAutomaticSmallTicket({...base,...patch}),false);
  for(const patch of [{confidencePct:51},{grade:"C-"},{edgePct:-1},{simHit:0.4}]) assert.equal(canCompleteAutomaticSmallTicket({...base,picks:[{...picks[0]!,finalAiScore:{...picks[0]!.finalAiScore,...patch}} as ParsedPick,picks[1]!]}),false);
});
test("completed staged ticket cancels owned work without cancelling caller or waiting for blocked work",async()=>{
  const parent=new AbortController();let owned:AbortSignal|undefined;let aborted=false;
  const result=await runScanUntilTargetSatisfied(parent.signal,true,async(signal,complete)=>{
    owned=signal;signal!.addEventListener("abort",()=>{aborted=true;});
    complete("qualified-ticket");return "must-not-replace-ticket";
  });
  assert.equal(result,"qualified-ticket");assert.equal(aborted,true);assert.equal(owned?.aborted,true);assert.equal(parent.signal.aborted,false);
});
test("no full ticket retains ordinary completion and failures; parent cancellation propagates",async()=>{
  const parent=new AbortController();
  assert.equal(await runScanUntilTargetSatisfied(parent.signal,true,async()=>"underfilled"),"underfilled");
  await assert.rejects(runScanUntilTargetSatisfied(parent.signal,true,async()=>{throw Error("real failure");}),/real failure/);
  let observed=false;
  await runScanUntilTargetSatisfied(parent.signal,true,async(signal)=>{parent.abort();observed=signal!.aborted;return "cancelled";});
  assert.equal(observed,true);
});

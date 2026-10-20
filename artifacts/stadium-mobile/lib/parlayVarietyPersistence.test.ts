import test from "node:test";
import assert from "node:assert/strict";
import { configureParlayVarietyMemory, rememberParlayBuild, recentParlayLegKeys, parlayVarietyOwner, parlayLegKey } from "./parlayVarietyMemory.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
const pick = { game: "A @ B", market: "Points", player: "Player One", pick: "Over 20.5", isProp: true } as ParsedPick;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test("history persists across reopen and isolates users", async () => {
 const rows = new Map<string,string>();
 const adapter = {getItem:async(k:string)=>rows.get(k)??null,setItem:async(k:string,v:string)=>{rows.set(k,v);}};
 await configureParlayVarietyMemory("one",adapter);rememberParlayBuild([pick]);await tick();
 await configureParlayVarietyMemory("two",adapter);assert.equal(recentParlayLegKeys().size,0);
 await configureParlayVarietyMemory("one",adapter);assert.ok(recentParlayLegKeys().has(parlayLegKey(pick)));
 rememberParlayBuild([{...pick,player:"Other"}],"two");assert.equal(recentParlayLegKeys().size,1);
});
test("late hydration from old account cannot leak into current account",async()=>{
 let resolveOld!:(value:string|null)=>void;
 const adapter={getItem:(k:string)=>k.endsWith("old")?new Promise<string|null>(r=>{resolveOld=r;}):Promise.resolve(null),setItem:async()=>{}};
 const old=configureParlayVarietyMemory("old",adapter);await configureParlayVarietyMemory("new",adapter);
 resolveOld(JSON.stringify({day:"irrelevant",builds:[]}));await old;assert.equal(parlayVarietyOwner(),"new");assert.equal(recentParlayLegKeys().size,0);
});
test("tiny alternate ladder changes remain the same recently shown idea",()=>{
 assert.equal(parlayLegKey(pick),parlayLegKey({...pick,market:"Alt Points",pick:"Over 19.5"}));
 assert.equal(parlayLegKey({game:"A @ B",market:"Spread",pick:"A +3.5"}),parlayLegKey({game:"A @ B",market:"Alt Spread",pick:"A +4.5"}));
 assert.notEqual(parlayLegKey(pick),parlayLegKey({...pick,player:"Other"}));
});
test("corrupt, stale and unavailable local history do not block builds",async()=>{
 for(const value of ["not-json",JSON.stringify({day:"2000-1-1",builds:[{}]})]) {
 const adapter={getItem:async()=>value,setItem:async()=>{}};await configureParlayVarietyMemory("safe",adapter);assert.equal(recentParlayLegKeys().size,0);
 }
 await configureParlayVarietyMemory("safe",{getItem:async()=>{throw Error("offline");},setItem:async()=>{}});rememberParlayBuild([pick]);assert.equal(recentParlayLegKeys().size,1);
});

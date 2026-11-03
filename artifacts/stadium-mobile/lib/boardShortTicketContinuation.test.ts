import test from "node:test";
import assert from "node:assert/strict";
import {shouldStopPropSimForTicketMix} from "./boardPropSimExpansion.ts";
import {prioritizeUnscannedPropSeeds} from "./coachPropSimCoverage.ts";
import type {ParsedPick} from "../components/PickCard.tsx";
const p=(id:string,market="player_reception_yds"):ParsedPick=>({isProp:true,game:"A @ B",sport:"nfl",eventId:"e",athleteId:id,player:id,market,propMarketKey:market,pick:`${id} Over 10.5`,propLine:10.5,propSide:"Over",odds:-110});
test("short assembled ticket continues; full ticket stops; exhaustive asks continue",()=>{
 for(const n of [0,6,7,8]) assert.equal(shouldStopPropSimForTicketMix({target:8,scored:[],assembledTicket:Array.from({length:n},(_,i)=>p(String(i)))}),n===8);
 assert.equal(shouldStopPropSimForTicketMix({target:8,scored:[],assembledTicket:Array.from({length:8},(_,i)=>p(String(i))),exhaustPropBoard:true}),false);
});
test("next wave keeps all seeds, prioritizing new players then market families",()=>{
 const old=p("one"),same=p("one","player_pass_yds"),fresh=p("two"),family=p("three","player_anytime_td");
 assert.deepEqual(prioritizeUnscannedPropSeeds([same,fresh,family],[old]),[family,fresh,same]);
});

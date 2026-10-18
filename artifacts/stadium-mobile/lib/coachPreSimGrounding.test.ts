import assert from "node:assert/strict";
import {test} from "node:test";
import {filterUngroundedCoachPropPool} from "./coachPreSimGrounding.ts";
const row=(player:string,teamAbbr:string,game:string,sport="mlb")=>({
 player,teamAbbr,game,sport,marketLabel:"Hits",marketKey:"batter_hits",line:0.5,
 side:"Over" as const,odds:-110,
});
test("pre-sim grounds player teams before expensive scoring",()=>{
 const rows=[row("Junior Caminero","TB","Rays @ Guardians"),
 row("Aaron Judge","NYY","Rays @ Guardians"),
 row("Unknown","", "Rays @ Guardians"),
 row("Jose Ramirez","CLE","Rays @ Guardians")];
 assert.deepEqual(filterUngroundedCoachPropPool(rows).map(x=>x.player),["Junior Caminero","Jose Ramirez"]);
});
test("NHL wrong-team prop and missing team are excluded, legitimate game retained",()=>{
 const rows=[row("Unverified","NYY","Columbus Blue Jackets @ Minnesota Wild","nhl"),
 row("Unidentified","","Columbus Blue Jackets @ Minnesota Wild","nhl"),
 row("Roster verified elsewhere","MIN","Columbus Blue Jackets @ Minnesota Wild","nhl")];
 assert.deepEqual(filterUngroundedCoachPropPool(rows).map(x=>x.player),["Roster verified elsewhere"]);
});
test("empty player identity is not misclassified as a proven mismatch",()=>{
 assert.equal(filterUngroundedCoachPropPool([row("","","")]).length,1);
});

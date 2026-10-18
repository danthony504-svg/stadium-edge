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

test("known ESPN fixture team IDs reject player assigned to unrelated club",()=>{
 const game={id:"g1",sport:"nhl",name:"Columbus Blue Jackets @ Minnesota Wild",shortName:"CBJ @ MIN",homeTeamId:"30",awayTeamId:"29",status:"pre",startsAt:"2026-10-18T23:00:00Z"};
 const rowN=(player:string,playerTeamId:string)=>({...row(player,"MIN",game.name,"nhl"),playerTeamId});
 const result=filterUngroundedCoachPropPool([rowN("Wrong team","21"),rowN("Matching host","30"),rowN("Matching away","29")],[game]);
 assert.deepEqual(result.map(x=>x.player),["Matching host","Matching away"]);
});
test("game labels with ambiguous ESPN identities do not fabricate team mapping",()=>{
 const game={id:"g1",sport:"nhl",name:"Columbus Blue Jackets @ Minnesota Wild",shortName:"CBJ @ MIN",homeTeamId:"30",awayTeamId:"29",status:"pre",startsAt:"2026-10-18T23:00:00Z"};
 const pick={...row("Uncertain","MIN",game.name,"nhl"),playerTeamId:"21"};
 assert.equal(filterUngroundedCoachPropPool([pick],[game,{...game,id:"g2"}]).length,1);
});

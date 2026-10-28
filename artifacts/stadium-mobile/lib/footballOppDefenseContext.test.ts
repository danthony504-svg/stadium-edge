import test from "node:test";
import assert from "node:assert/strict";
import { loadFootballOppRushDefense } from "./footballOppDefenseContext.ts";
import type { EspnGame } from "./api.ts";

test("posted NBA/WNBA/NHL/MLB opponents survive a full NFL slate within the existing cap", async()=>{
 const games=[...Array.from({length:16},(_,i)=>({sport:"nfl",homeTeam:`NFL H${i}`,awayTeam:`NFL A${i}`,homeTeamId:`nh${i}`,awayTeamId:`na${i}`})),
 ...["nba","wnba","nhl","mlb"].map(sport=>({sport,homeTeam:`${sport} H`,awayTeam:`${sport} A`,homeTeamId:`${sport}h`,awayTeamId:`${sport}a`}))] as EspnGame[];
 const calls:string[]=[];const old=globalThis.fetch;
 globalThis.fetch=async(input)=>{const u=new URL(String(input),"https://example.test");const sport=u.searchParams.get("sport"),id=u.searchParams.get("teamId");calls.push(`${sport}#${id}`);return new Response(JSON.stringify({sport,teamId:id,teamName:id,avgPointsAgainst:100,defensive:{},offensive:{}}),{headers:{"content-type":"application/json"}});};
 try{
 const map=await loadFootballOppRushDefense({espnGames:games,priorityGames:games.slice(16).map(g=>({sport:g.sport,game:`${g.awayTeam} @ ${g.homeTeam}`}))});
 assert.equal(calls.length,24);
 for(const sport of ["nba","wnba","nhl","mlb"]) for(const side of ["h","a"]) {assert.ok(map[`${sport}#${sport}${side}`]);assert.ok(calls.slice(0,8).includes(`${sport}#${sport}${side}`));}
 assert.equal(new Set(calls).size,calls.length);
 }finally{globalThis.fetch=old;}
});

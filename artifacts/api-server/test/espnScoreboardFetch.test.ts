import assert from "node:assert/strict";
import test from "node:test";
import { fetchEspnScoreboardDays } from "../src/lib/espnScoreboardFetch.js";

test("single-day reads are bounded, deduplicated and never send a range", async () => {
 let active=0, peak=0; const urls: string[]=[];
 const days=Array.from({length:9}, (_,i)=>`202610${String(20+i).padStart(2,"0")}`);
 const events=await fetchEspnScoreboardDays<{id:string}>("basketball/nba", [...days,days[0]!], async url=>{
  urls.push(url); active++; peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,1)); active--;
  return {events:[{id:new URL(url).searchParams.get("dates")!}]};
 });
 assert.equal(events.length,9); assert.equal(urls.length,9); assert.ok(peak<=4);
 assert.ok(urls.every(u=>/^\d{8}$/.test(new URL(u).searchParams.get("dates")!)));
});
test("partial failures remain unknown; total failure is explicit", async () => {
 const events=await fetchEspnScoreboardDays("football/nfl", ["20261022","20261023"], async url=>{
  if(url.includes("20261022")) throw Error("400"); return {events:[{id:"real"}]};
 });
 assert.deepEqual(events,[{id:"real"}]);
 await assert.rejects(()=>fetchEspnScoreboardDays("football/nfl",["20261023"],async()=>{throw Error("400");}),/all_days_failed/);
 await assert.rejects(()=>fetchEspnScoreboardDays("football/nfl",["20261022-20261023"]),/invalid_espn/);
});
test("daily tournament payloads survive identical event ids", async () => {
 let i=0;
 const events=await fetchEspnScoreboardDays("tennis/atp",["20261022","20261023"],async()=>({events:[{id:"tournament", competition:`match-${i++}` }]}));
 assert.equal(events.length,2);
});

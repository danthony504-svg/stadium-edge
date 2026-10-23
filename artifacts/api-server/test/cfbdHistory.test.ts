import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {normalizeCfbdHistory,importCfbdHistory,cfbdImportSummary} from "../src/lib/cfbdHistory.js";
const now=Date.parse("2026-10-21T12:00Z");
const game={id:123,season:2025,week:1,seasonType:"regular",startDate:"2025-08-30T18:00Z",completed:true,homeClassification:"fbs",awayClassification:"fbs",homeId:1,awayId:2,homePoints:28,awayPoints:21,homeLineScores:[7,7,7,7],awayLineScores:[7,7,0,7]};
const line={id:123,season:2025,week:1,seasonType:"regular",startDate:game.startDate,homeTeamId:1,awayTeamId:2,lines:[{provider:"fixture-book",spread:-3.5,overUnder:49.5,homeMoneyline:-150,awayMoneyline:130}]};
test("exact completed FBS joins preserve real fields without invented prices/timestamps",()=>{
 const s=normalizeCfbdHistory([game],[line],2025,1,now);assert.equal(s.games.length,1);assert.equal(s.quotes.length,1);assert.equal(s.games[0]!.overtime,false);assert.equal(s.quotes[0]!.homeSpread,-3.5);assert.equal(s.quotes[0]!.quoteObservedAt,null);assert.equal(s.validationReady,false);assert.ok(s.limitations.includes("team_totals_not_supplied"));
});
test("reject changed identity, missing scores, future games and duplicates",()=>{
 const s=normalizeCfbdHistory([game,game,{...game,id:124,homePoints:null},{...game,id:125,startDate:"2999-01-01"}],[{...line,homeTeamId:9}],2025,1,now);
 assert.equal(s.games.length,1);assert.equal(s.quotes.length,0);assert.equal(s.rejected.duplicate_game,1);assert.equal(s.rejected.not_completed_with_real_scores,2);assert.equal(s.rejected.line_event_identity_mismatch,1);
});
test("nullable moneylines are never coerced into odds",()=>{
 const s=normalizeCfbdHistory([game],[{...line,lines:[{provider:"fixture-book",spread:0,overUnder:0,homeMoneyline:null,awayMoneyline:0}]}],2025,1,now);
 assert.equal(s.quotes[0]!.homeMoneyline,null);assert.equal(s.quotes[0]!.awayMoneyline,null);assert.equal(s.quotes[0]!.homeSpread,0);
});
test("two requests are authenticated server-side and normalized archive excludes credentials",async()=>{
 const secret="private-test-fixture-not-live";const calls:string[]=[];const dir=await mkdtemp(join(tmpdir(),"cfbd-import-test-"));
 const fetcher=(async(url:unknown,opts?:RequestInit)=>{calls.push(String(url));assert.equal((opts!.headers as Record<string,string>).Authorization,`Bearer ${secret}`);assert.equal(opts!.redirect,"error");return new Response(JSON.stringify(calls.length===1?[game]:[line]));}) as typeof fetch;
 try{const result=await importCfbdHistory(2025,1,{apiKey:secret,fetcher,directory:dir,now});assert.equal(calls.length,2);const content=await readFile(result.file!,"utf8");assert.ok(!content.includes(secret));assert.equal((await stat(result.file!)).mode&0o777,0o600);assert.equal(cfbdImportSummary(result).matchedGames,1);}finally{await rm(dir,{recursive:true,force:true});}
});
test("missing key, HTTP denial and leaked provider error are sanitized",async()=>{
 await assert.rejects(importCfbdHistory(2025,1,{apiKey:"",persist:false}),/cfbd_key_not_configured/);
 await assert.rejects(importCfbdHistory(2025,1,{apiKey:"fixture",persist:false,fetcher:(async()=>new Response("sensitive response",{status:401})) as typeof fetch}),/^Error: cfbd_http_401$/);
 await assert.rejects(importCfbdHistory(2025,1,{apiKey:"fixture",persist:false,fetcher:(async()=>{throw Error("Bearer fixture");}) as typeof fetch}),/^Error: cfbd_games_network_error$/);
});

test("request failures identify stage and category without private details",async()=>{
 for(const stage of ["games","lines"])for(const reason of ["timeout","invalid_json"]){
  let calls=0;
  const fetcher=(async()=>{calls++;if(stage==="lines"&&calls===1)return new Response(JSON.stringify([game]));if(reason==="timeout")throw new DOMException("private details","TimeoutError");return new Response("private invalid JSON");}) as typeof fetch;
  await assert.rejects(importCfbdHistory(2025,1,{apiKey:"fixture",persist:false,fetcher,now}),new RegExp(`^Error: cfbd_${stage}_${reason}$`));
 }
});

test("new imports preserve only consistent observed OT regulation scores",()=>{
 const ot={...game,homePoints:31,awayPoints:28,homeLineScores:[7,7,7,3,7],awayLineScores:[7,7,7,3,4]};
 const g=normalizeCfbdHistory([ot],[],2025,1,now).games[0]!;
 assert.equal(g.regulationHomePoints,24);assert.equal(g.regulationAwayPoints,24);
 for(const patch of [{homeLineScores:undefined},{homeLineScores:[7,7,7,3.5,7]},{awayLineScores:[7,7,7,0,7]}]){
  const invalid=normalizeCfbdHistory([{...ot,...patch}],[],2025,1,now).games[0]!;
  assert.equal(invalid.regulationHomePoints,null);assert.equal(invalid.regulationAwayPoints,null);
 }
});

/** Server/worker historical import only. Never invoked by Coach or mobile. */
import {saveCfbdArchive} from "./cfbdArchive.js";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
export type CfbdGame={eventId:string;season:number;kickoff:string;homeId:string;awayId:string;homePoints:number;awayPoints:number;overtime:boolean|null};
export type CfbdQuote={eventId:string;provider:string;homeSpread:number|null;total:number|null;homeMoneyline:number|null;awayMoneyline:number|null;quoteObservedAt:null;isVerifiedClosing:false};
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const numericId=(v:unknown):boolean=>(typeof v==="number"&&Number.isSafeInteger(v)&&v>0)||(typeof v==="string"&&/^\d+$/.test(v));
export function normalizeCfbdHistory(gamesRaw:unknown,linesRaw:unknown,year:number,week:number,observedAt=Date.now()) {
 if(!Array.isArray(gamesRaw)||!Array.isArray(linesRaw))throw Error("cfbd_invalid_response");
 const games:CfbdGame[]=[],quotes:CfbdQuote[]=[],rejected:Record<string,number>={};const seen=new Set<string>();
 const reject=(why:string)=>{rejected[why]=(rejected[why]??0)+1;};
 for(const g of gamesRaw){
  if(!g||!numericId(g.id)||g.season!==year||g.week!==week||g.seasonType!=="regular"||g.homeClassification!=="fbs"||g.awayClassification!=="fbs"||!numericId(g.homeId)||!numericId(g.awayId)||String(g.homeId)===String(g.awayId)){reject("game_identity_or_scope");continue;}
  if(g.completed!==true||!Number.isFinite(Date.parse(g.startDate))||Date.parse(g.startDate)>=observedAt||!finite(g.homePoints)||!finite(g.awayPoints)||g.homePoints<0||g.awayPoints<0){reject("not_completed_with_real_scores");continue;}
  if(seen.has(String(g.id))){reject("duplicate_game");continue;}seen.add(String(g.id));
  const periods=Array.isArray(g.homeLineScores)&&Array.isArray(g.awayLineScores)?Math.max(g.homeLineScores.length,g.awayLineScores.length):null;
  games.push({eventId:String(g.id),season:year,kickoff:g.startDate,homeId:String(g.homeId),awayId:String(g.awayId),homePoints:g.homePoints,awayPoints:g.awayPoints,overtime:periods==null?null:periods>4?true:periods===4?false:null});
 }
 const byId=new Map(games.map(g=>[g.eventId,g]));const quoteKeys=new Set<string>();
 for(const row of linesRaw){
  const g=row&&byId.get(String(row.id));
  if(!g||row.season!==year||row.week!==week||row.seasonType!=="regular"||String(row.homeTeamId)!==g.homeId||String(row.awayTeamId)!==g.awayId||Date.parse(row.startDate)!==Date.parse(g.kickoff)){reject("line_event_identity_mismatch");continue;}
  for(const line of Array.isArray(row.lines)?row.lines:[]){
   if(typeof line.provider!=="string"||!line.provider.trim()){reject("missing_book");continue;}
   const q:CfbdQuote={eventId:g.eventId,provider:line.provider,homeSpread:finite(line.spread)?line.spread:null,total:finite(line.overUnder)?line.overUnder:null,homeMoneyline:finite(line.homeMoneyline)&&Math.abs(line.homeMoneyline)>=100?line.homeMoneyline:null,awayMoneyline:finite(line.awayMoneyline)&&Math.abs(line.awayMoneyline)>=100?line.awayMoneyline:null,quoteObservedAt:null,isVerifiedClosing:false};
   if(q.homeSpread==null&&q.total==null&&q.homeMoneyline==null&&q.awayMoneyline==null){reject("no_real_line");continue;}
   const key=JSON.stringify(q);if(quoteKeys.has(key)){reject("duplicate_quote");continue;}quoteKeys.add(key);quotes.push(q);
  }
 }
 return {version:1,source:"cfbd",year,week,importedAt:new Date(observedAt).toISOString(),games,quotes,rejected,validationReady:false,limitations:["historical_quote_timestamps_unverified","spread_total_prices_not_supplied","team_totals_not_supplied","pregame_forecast_journal_missing"]};
}
let running=false;let lastAttempt=0;
export async function importCfbdHistory(year:number,week:number,opts:{fetcher?:typeof fetch;apiKey?:string;directory?:string;now?:number;persist?:boolean}={}) {
 if(!Number.isInteger(year)||year<2013||year>new Date().getUTCFullYear()||!Number.isInteger(week)||week<1||week>16)throw Error("cfbd_invalid_year_or_week");
 const apiKey=(opts.apiKey??process.env.CFBD_API_KEY??"").trim();if(!apiKey)throw Error("cfbd_key_not_configured");
 const fetcher=opts.fetcher??fetch,now=opts.now??Date.now();
 // Public endpoint is cron-authenticated, but repeated manual calls must still be bounded.
 if(!opts.fetcher&&(running||now-lastAttempt<60_000))throw Error("cfbd_import_busy_or_rate_limited");
 if(!opts.fetcher){running=true;lastAttempt=now;}
 const get=async(path:"games"|"lines")=>{
  try{
   const response=await fetcher(`https://api.collegefootballdata.com/${path}?year=${year}&week=${week}&seasonType=regular${path==="games"?"&classification=fbs":""}`,{headers:{Authorization:`Bearer ${apiKey}`,Accept:"application/json"},signal:AbortSignal.timeout(8000),redirect:"error"});
   if(!response.ok)throw Error(`cfbd_http_${response.status}`);
   const content=await response.text();if(content.length>12_000_000)throw Error("cfbd_response_too_large");return JSON.parse(content);
  }catch(error){const message=error instanceof Error?error.message:"";throw Error(/^cfbd_(?:http_\d+|response_too_large)$/.test(message)?message:"cfbd_network_or_payload_error");}
 };
 try{
  // Sequential two-call batch limits quota/concurrency. No automatic retry.
  const games=await get("games"),lines=await get("lines"),snapshot=normalizeCfbdHistory(games,lines,year,week,now);
  const hash=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  let file:string|null=null;
  if(opts.persist!==false){const dir=resolve(opts.directory??process.env.CFBD_HISTORY_DIR??"var/cfbd-history");await mkdir(dir,{recursive:true,mode:0o700});file=join(dir,`${year}-w${week}-${now}-${hash.slice(0,12)}.json`);await writeFile(file,JSON.stringify(snapshot),{flag:"wx",mode:0o600});}
  let databaseArchived=false;
  if(opts.persist!==false&&process.env.CFBD_HISTORY_DATABASE_URL){await saveCfbdArchive(snapshot,process.env.CFBD_HISTORY_DATABASE_URL);databaseArchived=true;}
  return {snapshot,file,sha256:hash,databaseArchived};
 } finally{if(!opts.fetcher)running=false;}
}
export function cfbdImportSummary(result:Awaited<ReturnType<typeof importCfbdHistory>>) {
 const {snapshot:s}=result;
 return {ok:true,source:s.source,year:s.year,week:s.week,importedAt:s.importedAt,completedGames:s.games.length,quoteRows:s.quotes.length,matchedGames:new Set(s.quotes.map(q=>q.eventId)).size,rejected:s.rejected,validationReady:false,limitations:s.limitations,sha256:result.sha256,databaseArchived:result.databaseArchived};
}

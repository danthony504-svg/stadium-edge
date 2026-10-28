import {cachedJson,ESPN_SPORT_PATHS} from './sports.js';
import {aggregateOpponentMarkets,opponentMarketRules,type MarketAllowanceBox,type MarketAllowanceRow} from './opponentMarketAllowance.js';
const ready=new Map<string,{expires:number;rows:MarketAllowanceRow[]}>(),pending=new Map<string,Promise<MarketAllowanceRow[]>>();
/** Coach gets cached evidence immediately; cold work prewarms in background, not on ticket's critical path. */
export async function opponentMarketAllowance(sport:string,teamId:string,wait=false):Promise<MarketAllowanceRow[]>{
 if(!opponentMarketRules(sport).length)return [];
 const key=sport+':'+teamId,old=ready.get(key);if(old&&old.expires>Date.now())return old.rows;
 let work=pending.get(key);if(!work&&pending.size>=8)return [];if(!work){work=cachedJson(`opponent-markets:${key}:v3`,60*60*1000,async()=>{
  const path=ESPN_SPORT_PATHS[sport],read=async(url:string)=>{const r=await fetch(url,{signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('opponent source unavailable');return r.json();};
  let schedule=await read(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${encodeURIComponent(teamId)}/schedule`) as {season?:{year?:number;type?:number};events?:Array<{id?:string;date?:string;competitions?:Array<{status?:{type?:{completed?:boolean}}}>}>};
  if ((schedule.events??[]).filter(e=>e.competitions?.[0]?.status?.type?.completed).length < 3 && Number.isSafeInteger(schedule.season?.year) && schedule.season?.type !== 2) {
    const regular=await read(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${encodeURIComponent(teamId)}/schedule?season=${schedule.season!.year}&seasontype=2`) as typeof schedule;
    if (regular.season?.year === schedule.season?.year) schedule={...schedule,events:[...(schedule.events??[]),...(regular.events??[])]};
  }
  const now=Date.now(),events=[...new Map((schedule.events??[]).filter(e=>e.id&&e.date&&Date.parse(e.date)<now&&e.competitions?.[0]?.status?.type?.completed).map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(b.date!)-Date.parse(a.date!)).slice(0,8),boxes:MarketAllowanceBox[]=[];
  for(let i=0;i<events.length;i+=4)boxes.push(...await Promise.all(events.slice(i,i+4).map(async e=>{try{const prefix=sport==='nhl'?'nhl-shot-box':`opponent-box:${sport}`;const b=await cachedJson<MarketAllowanceBox>(`${prefix}:${e.id}:v1`,6*60*60*1000,()=>read(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(e.id!)}`) as Promise<MarketAllowanceBox>);return b.header?.id===e.id?b:{};}catch{return {};}})));
  return aggregateOpponentMarkets(sport,teamId,boxes,now);
 }).catch(()=>[]).then(rows=>{if(ready.size>=256)ready.delete(ready.keys().next().value!);ready.set(key,{expires:Date.now()+(rows.length?60*60*1000:60*1000),rows});return rows;}).finally(()=>pending.delete(key));pending.set(key,work);}
 return wait?work:[];
}

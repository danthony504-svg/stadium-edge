import { cachedJson, ESPN_SPORT_PATHS } from './sports.js';
import { aggregatePositionAllowances, type AllowanceBox, type PositionAllowance } from './positionAllowance.js';
/** Bounded cached evidence collection; unsupported or missing boxes remain empty. */
export async function basketballDefenseAllowed(sport:string,teamId:string):Promise<PositionAllowance|null>{
 if(!['nba','wnba','ncaab'].includes(sport))return null;
 const path=ESPN_SPORT_PATHS[sport];
 const read=async(url:string)=>{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Evidence source unavailable');return r.json();};
 return cachedJson(`position-allowed:${sport}:${teamId}:v1`,60*60*1000,async()=>{
  const schedule=await read(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${encodeURIComponent(teamId)}/schedule`) as {events?:Array<{id?:string;date?:string;competitions?:Array<{status?:{type?:{completed?:boolean}}}>}>};
  const now=Date.now();
  const events=[...new Map((schedule.events??[]).filter(e=>e.id&&e.date&&Date.parse(e.date)<now&&e.competitions?.[0]?.status?.type?.completed).map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(b.date!)-Date.parse(a.date!)).slice(0,8);
  const boxes:AllowanceBox[]=[];
  for(let i=0;i<events.length;i+=4){
   const batch=await Promise.all(events.slice(i,i+4).map(async e=>{
    try{const box = await cachedJson<AllowanceBox>(`position-box:${sport}:${e.id}:v1`,6*60*60*1000,()=>read(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(e.id!)}`) as Promise<AllowanceBox>);return box.header?.id === e.id ? box : {};}catch{return {};}
   }));boxes.push(...batch);
  }
  return {source:'ESPN completed opponent player box scores; primary positions; pooled per-36 minutes',receivedAt:new Date().toISOString(),rows:aggregatePositionAllowances(boxes,teamId,now)};
 }).catch(()=>null);
}

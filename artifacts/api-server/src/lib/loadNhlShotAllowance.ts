import {cachedJson} from './sports.js';
import {nhlShotAllowance,type ShotBox,type NhlShotAllowance} from './nhlShotAllowance.js';
export async function loadNhlShotAllowance(teamId:string):Promise<NhlShotAllowance|null>{
 return cachedJson(`nhl-shot-allowance:${teamId}:v1`,60*60*1000,async()=>{
  const read=async(url:string)=>{const r=await fetch(url,{signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('shot evidence unavailable');return r.json();};
  const schedule=await read(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${encodeURIComponent(teamId)}/schedule`) as {events?:Array<{id?:string;date?:string;competitions?:Array<{status?:{type?:{completed?:boolean}}}>}>};
  const now=Date.now(),events=[...new Map((schedule.events??[]).filter(e=>e.id&&e.date&&Date.parse(e.date)<now&&e.competitions?.[0]?.status?.type?.completed).map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(b.date!)-Date.parse(a.date!)).slice(0,8);
  const boxes:ShotBox[]=[];
  for(let i=0;i<events.length;i+=4)boxes.push(...await Promise.all(events.slice(i,i+4).map(async e=>{try{const b=await cachedJson<ShotBox>(`nhl-shot-box:${e.id}:v1`,6*60*60*1000,()=>read(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${encodeURIComponent(e.id!)}`) as Promise<ShotBox>);return b.header?.id===e.id?b:{};}catch{return {};}})));
  return nhlShotAllowance(boxes,teamId,now);
 }).catch(()=>null);
}

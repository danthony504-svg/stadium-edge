/** Team shots allowed from final opponent box scores. Never substitute saves, attempts or season totals. */
export type NhlShotAllowance = { shotsAllowedPerGame:number; sampleSize:number; firstGame:string; lastGame:string; source:string };
export type ShotBox = { header?:{id?:string;competitions?:Array<{date?:string;status?:{type?:{completed?:boolean}};competitors?:Array<{team?:{id?:string}}>}>};boxscore?:{teams?:Array<{team?:{id?:string};statistics?:Array<{name?:string;displayValue?:string;value?:number}>}>} };
export function nhlShotAllowance(boxes:ShotBox[],teamId:string,cutoff=Date.now()):NhlShotAllowance|null {
 const games=new Map<string,{date:string;shots:number}>();
 for(const b of boxes){
  const c=b.header?.competitions?.[0],id=b.header?.id,date=c?.date;
  if(!id||games.has(id)||!date||!c?.status?.type?.completed||!Number.isFinite(Date.parse(date))||Date.parse(date)>=cutoff)continue;
  const ids=c.competitors?.map(t=>t.team?.id)??[];
  if(ids.length!==2||!ids.includes(teamId)||ids[0]===ids[1])continue;
  const opp=ids.find(x=>x!==teamId),rows=b.boxscore?.teams?.filter(t=>t.team?.id===opp)??[];
  if(rows.length!==1)continue;
  const stats=rows[0]!.statistics?.filter(s=>s.name==='shotsTotal')??[];
  if(stats.length!==1)continue;
  const raw=stats[0]!.value??stats[0]!.displayValue;
  if(raw==null||!/^\d+$/.test(String(raw)))continue;
  const shots=Number(raw);if(shots<0||shots>150)continue;
  games.set(id,{date,shots});
 }
 if(games.size<3)return null;
 const rows=[...games.values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 return {shotsAllowedPerGame:rows.reduce((a,b)=>a+b.shots,0)/rows.length,sampleSize:rows.length,firstGame:rows[0]!.date,lastGame:rows.at(-1)!.date,source:'ESPN completed opponent team box scores; full game including overtime'};
}

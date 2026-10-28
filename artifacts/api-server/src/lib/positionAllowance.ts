/** Observed basketball production allowed, grouped by verified primary box-score position.
 * Per-36 is pooled stat / pooled minutes, not a league ranking or matchup probability.
 */
export type PositionAllowanceRow = { position: string; market: string; per36: number; games: number; appearances: number; minutes: number; firstGame: string; lastGame: string };
export type PositionAllowance = { source: string; receivedAt: string; rows: PositionAllowanceRow[] };
export const basketballPosition = (p: unknown): string | null =>
  typeof p === "string" && /^(PG|SG|SF|PF|C)$/.test(p.toUpperCase()) ? p.toUpperCase() : null;
export type AllowanceBox = { header?: { id?: string; competitions?: Array<{date?:string;status?:{type?:{completed?:boolean}};competitors?:Array<{team?:{id?:string}}>}> }; boxscore?: { players?: Array<{team?:{id?:string};statistics?:Array<{labels?:string[];athletes?:Array<{didNotPlay?:boolean;athlete?:{id?:string;position?:{abbreviation?:string}};stats?:string[]}>}>}> } };
const fields: Record<string,string> = {PTS:'player_points',REB:'player_rebounds',AST:'player_assists',BLK:'player_blocks',STL:'player_steals'};
export function aggregatePositionAllowances(boxes: AllowanceBox[], teamId: string, nowMs=Date.now()): PositionAllowanceRow[] {
 const bins=new Map<string,{position:string;market:string;total:number;minutes:number;games:Map<string,string>;appearances:number}>();
 const seenEvents=new Set<string>();
 for(const box of boxes){
  const c=box.header?.competitions?.[0], id=box.header?.id, date=c?.date;
  if(!id||seenEvents.has(id)||!c?.status?.type?.completed||!date||!Number.isFinite(Date.parse(date))||Date.parse(date)>=nowMs)continue;
  const ids=c.competitors?.map(t=>t.team?.id).filter(Boolean)??[];
  if(ids.length!==2||!ids.includes(teamId)||ids[0]===ids[1])continue;
  const opponentId=ids.find(t=>t!==teamId);
  const teams=box.boxscore?.players?.filter(t=>t.team?.id===opponentId)??[];
  if(teams.length!==1)continue;
  seenEvents.add(id);
  const seen=new Set<string>();
  for(const group of teams[0]!.statistics??[]){
   const labels=group.labels??[], minIdx=labels.indexOf('MIN');
   if(minIdx<0||labels.lastIndexOf('MIN')!==minIdx)continue;
   for(const a of group.athletes??[]){
    const pos=basketballPosition(a.athlete?.position?.abbreviation), aid=a.athlete?.id, raw=a.stats?.[minIdx];
    if(a.didNotPlay||!aid||seen.has(aid)||!pos||!raw||!/^\d+(?::[0-5]\d|\.\d+)?$/.test(raw))continue;
    const [m,sec]=raw.split(':'), minutes=Number(m)+(sec?Number(sec)/60:0);
    if(!(minutes>0&&minutes<=80))continue;
    seen.add(aid);
    for(const [label,market] of Object.entries(fields)){
     const idx=labels.indexOf(label), value=idx>=0?a.stats?.[idx]:undefined;
     if(idx<0||labels.lastIndexOf(label)!==idx||value==null||!/^\d+(?:\.\d+)?$/.test(value))continue;
     const key=pos+':'+market, b=bins.get(key)??{position:pos,market,total:0,minutes:0,games:new Map<string,string>(),appearances:0};
     b.total+=Number(value);b.minutes+=minutes;b.games.set(id,date);b.appearances++;bins.set(key,b);
    }
   }
  }
 }
 return [...bins.values()].filter(b=>b.games.size>=3).map(b=>{
  const dates=[...b.games.values()].sort();
  return {position:b.position,market:b.market,per36:Math.round(b.total/b.minutes*360)/10,games:b.games.size,appearances:b.appearances,minutes:Math.round(b.minutes*10)/10,firstGame:dates[0]!,lastGame:dates.at(-1)!};
 });
}

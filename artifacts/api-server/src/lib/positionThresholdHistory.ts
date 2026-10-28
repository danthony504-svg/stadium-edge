import type {AllowanceBox} from './positionAllowance.js';
export type PositionThresholdRow={position:string;market:string;games:Array<{eventId:string;date:string;values:number[]}>};
const markets:Record<string,string>={PTS:'player_points',REB:'player_rebounds',AST:'player_assists',BLK:'player_blocks',STL:'player_steals','3PT':'player_threes'};
/** Complete opposing active-player boxes only; any unknown position stays unknown. */
export function positionThresholdHistory(boxes:AllowanceBox[],teamId:string,cutoff=Date.now()):PositionThresholdRow[]{
 const bins=new Map<string,PositionThresholdRow>(),seen=new Set<string>();
 for(const box of boxes){
  const c=box.header?.competitions?.[0],id=box.header?.id,date=c?.date,ids=c?.competitors?.map(x=>x.team?.id)??[];
  if(!id||seen.has(id)||!date||!c?.status?.type?.completed||!Number.isFinite(Date.parse(date))||Date.parse(date)>=cutoff||ids.length!==2||!ids.includes(teamId)||ids[0]===ids[1])continue;
  const opponents=box.boxscore?.players?.filter(x=>x.team?.id===ids.find(x=>x!==teamId))??[];if(opponents.length!==1)continue;
  const groups=opponents[0]!.statistics?.filter(g=>g.labels?.includes('MIN'))??[];if(groups.length!==1)continue;
  const g=groups[0]!,labels=g.labels!,mi=labels.indexOf('MIN');if(labels.lastIndexOf('MIN')!==mi)continue;
  const active=[] as Array<{position:string;stats:string[]}>;const athletes=new Set<string>();let complete=true;
  for(const a of g.athletes??[]){if(a.didNotPlay)continue;const raw=a.stats?.[mi];if(!raw||!/^\d+(?::[0-5]\d|\.\d+)?$/.test(raw)){complete=false;break;}if(Number(raw.split(':')[0])===0&&(!raw.includes(':')||Number(raw.split(':')[1])===0))continue;
   const aid=a.athlete?.id,pos=a.athlete?.position?.abbreviation?.toUpperCase();if(!aid||athletes.has(aid)||!pos||!['PG','SG','SF','PF','C','G','F'].includes(pos)){complete=false;break;}athletes.add(aid);active.push({position:pos,stats:a.stats!});
  }
  if(!complete||!active.length)continue;seen.add(id);
  for(const [label,market] of Object.entries(markets)){
   const i=labels.indexOf(label);if(i<0||labels.lastIndexOf(label)!==i)continue;
   const values=active.map(a=>{const v=a.stats[i];if(label==='3PT'){const m=v?.match(/^(\d+)-(\d+)$/);return m&&Number(m[1])<=Number(m[2])?Number(m[1]):null;}return v!=null&&/^\d+(?:\.\d+)?$/.test(v)?Number(v):null;});if(values.some(v=>v==null))continue;
   for(const position of ['PG','SG','SF','PF','C','G','F']){
    const matches=(p:string)=>p===position||(position==='G'&&['PG','SG'].includes(p))||(position==='F'&&['SF','PF'].includes(p));
    // Generic G/F cannot establish a specific PG/SG/SF/PF denominator.
    if(['PG','SG'].includes(position)&&active.some(a=>a.position==='G'))continue;
    if(['SF','PF'].includes(position)&&active.some(a=>a.position==='F'))continue;
    const key=position+':'+market,b:PositionThresholdRow=bins.get(key)??{position,market,games:[]};b.games.push({eventId:id,date,values:values.filter((_,j)=>matches(active[j]!.position)) as number[]});bins.set(key,b);
   }
  }
 }
 return [...bins.values()].filter(b=>b.games.length>=3);
}

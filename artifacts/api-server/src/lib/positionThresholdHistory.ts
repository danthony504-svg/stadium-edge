import type {AllowanceBox} from './positionAllowance.js';
export type PositionThresholdRow={position:string;market:string;games:Array<{eventId:string;date:string;values:number[]; carries?:number[]; minutes?:number[]; fieldGoalAttempts?:Array<number|null>; threePointAttempts?:Array<number|null>}>};
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
  const shotIndex=labels.indexOf('FG');
  const active=[] as Array<{position:string;stats:string[];minutes:number;attempts:number|null}>;const athletes=new Set<string>();let complete=true;
  for(const a of g.athletes??[]){if(a.didNotPlay)continue;const raw=a.stats?.[mi];if(!raw||!/^\d+(?::[0-5]\d|\.\d+)?$/.test(raw)){complete=false;break;}if(Number(raw.split(':')[0])===0&&(!raw.includes(':')||Number(raw.split(':')[1])===0))continue;
   const aid=a.athlete?.id,pos=a.athlete?.position?.abbreviation?.toUpperCase();if(!aid||athletes.has(aid)||!pos||!['PG','SG','SF','PF','C','G','F'].includes(pos)){complete=false;break;}athletes.add(aid);
   const [whole, seconds] = raw.split(':');
   const minutes = Number(whole) + Number(seconds ?? 0) / 60;
   const shot = shotIndex >= 0 && labels.lastIndexOf('FG') === shotIndex
     ? a.stats?.[shotIndex]?.match(/^(\d+)-(\d+)$/)
     : null;
   const attempts = shot && Number(shot[1]) <= Number(shot[2]) ? Number(shot[2]) : null;
   active.push({position:pos,stats:a.stats!,minutes,attempts});
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
    const key = position + ':' + market;
    const row: PositionThresholdRow = bins.get(key) ?? { position, market, games: [] };
    const players = active.filter(a => matches(a.position));
    row.games.push({
      eventId: id, date,
      values: values.filter((_, j) => matches(active[j]!.position)) as number[],
      minutes: players.map(a => a.minutes),
      fieldGoalAttempts: players.map(a => a.attempts),
      ...(label === '3PT' ? { threePointAttempts: players.map(a => Number(a.stats[i]!.split('-')[1])) } : {}),
    });
    bins.set(key, row);
   }
  }
 }
 return [...bins.values()].filter(b=>b.games.length>=3);
}

/** Completed opponent rushing boxes, retaining individual RB workloads. */
export function rushingBackHistory(boxes: AllowanceBox[], teamId: string, cutoff: number): PositionThresholdRow[] {
  const games = new Map<string, PositionThresholdRow["games"][number]>();
  for (const box of boxes) {
    const eventId = box.header?.id;
    const game = box.header?.competitions?.[0];
    const date = game?.date;
    const teams = game?.competitors?.map((entry) => entry.team?.id) ?? [];
    if (!eventId || !date || games.has(eventId) || !(Date.parse(date) < cutoff) ||
        !game?.status?.type?.completed || teams.length !== 2 || !teams.includes(teamId)) continue;
    const opponent = teams.find((id) => id && id !== teamId);
    if (!opponent) continue;
    const groups = (box.boxscore?.players ?? []).filter((entry) => entry.team?.id === opponent)
      .flatMap((entry) => entry.statistics ?? []).filter((group) => group.name === "rushing");
    if (groups.length !== 1) continue;
    const { labels = [], athletes = [] } = groups[0]!;
    const car = labels.indexOf("CAR"), yds = labels.indexOf("YDS");
    if (car < 0 || yds < 0 || labels.lastIndexOf("CAR") !== car || labels.lastIndexOf("YDS") !== yds) continue;
    const active = athletes.filter((row) => !row.didNotPlay);
    const ids = new Set(active.map((row) => row.athlete?.id));
    if (ids.size !== active.length || active.some((row) => !row.athlete?.id || !row.athlete.position?.abbreviation)) continue;
    const backs = active.filter((row) => ["RB", "HB"].includes(row.athlete!.position!.abbreviation!.toUpperCase()));
    if (backs.some((row) => !/^\d+$/.test(row.stats?.[car] ?? "") || !/^-?\d+$/.test(row.stats?.[yds] ?? ""))) continue;
    const carriers = backs.filter((row) => Number(row.stats![car]) > 0);
    if (carriers.length) games.set(eventId, {
      eventId, date,
      values: carriers.map((row) => Number(row.stats![yds])),
      carries: carriers.map((row) => Number(row.stats![car])),
    });
  }
  return games.size >= 3 ? [{ position: "RB", market: "player_rush_yds", games: [...games.values()] }] : [];
}

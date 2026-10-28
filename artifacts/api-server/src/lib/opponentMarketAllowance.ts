/** Verified team-level context. A team total is never an individual projection. */
export type MarketAllowanceRow={games?:Array<{eventId:string;date:string;value:number}>;market:string;perGame:number;sampleSize:number;firstGame:string;lastGame:string;scope:'team_allowed'|'team_offensive_exposure';source:string};
export type MarketAllowanceBox={header?:{id?:string;competitions?:Array<{date?:string;status?:{type?:{completed?:boolean}};competitors?:Array<{team?:{id?:string};score?:string|number}>}>};boxscore?:{players?:Array<{team?:{id?:string};statistics?:Array<{labels?:string[];totals?:string[]}>}>;teams?:Array<{team?:{id?:string};statistics?:Array<{name?:string;value?:number|string;displayValue?:string}>}>}};
type Rule={market:string;fields:string[][];scope:'team_allowed'|'team_offensive_exposure'};
const rule=(market:string,fields:string[][],scope:Rule['scope']='team_allowed'):Rule=>({market,fields,scope});
export function opponentMarketRules(sport:string):Rule[]{
 if(['nba','wnba','ncaab'].includes(sport))return [rule('player_points',[['points']]),rule('player_rebounds',[['totalRebounds']]),rule('player_assists',[['assists']]),rule('player_blocks',[['blocks']]),rule('player_steals',[['steals']]),rule('player_turnovers',[['turnovers']]),rule('player_threes',[['threePointFieldGoalsMade']]),rule('player_points_rebounds_assists',[['points'],['totalRebounds'],['assists']]),rule('player_points_rebounds',[['points'],['totalRebounds']]),rule('player_points_assists',[['points'],['assists']])];
 if(['nfl','ncaaf'].includes(sport))return [rule('player_rush_yds',[['rushingYards']]),rule('player_rush_attempts',[['rushingAttempts']]),rule('player_pass_yds',[['passingYards','netPassingYards']]),rule('player_pass_attempts',[['passingAttempts']]),rule('player_pass_completions',[['completions']]),rule('player_receptions',[['receptions']]),rule('player_reception_yds',[['receivingYards']]),rule('player_sacks',[['sacks']],'team_offensive_exposure'),rule('player_interceptions',[['interceptions']],'team_offensive_exposure')];
 if(sport==='nhl')return [rule('player_shots_on_goal',[['shotsTotal']]),rule('player_goals',[['goals']]),rule('player_assists',[['assists']]),rule('player_points',[['goals'],['assists']]),rule('player_blocked_shots',[['blockedShots']])];
 if(sport==='mlb')return [rule('batter_hits',[['hits']]),rule('batter_runs_scored',[['runs']]),rule('batter_rbis',[['RBIs','runsBattedIn']]),rule('batter_home_runs',[['homeRuns']]),rule('batter_stolen_bases',[['stolenBases']]),rule('pitcher_strikeouts',[['strikeouts']],'team_offensive_exposure'),rule('pitcher_hits_allowed',[['hits']],'team_offensive_exposure'),rule('pitcher_walks',[['walks']],'team_offensive_exposure')];
 if(sport==='soccer')return [rule('player_shots',[['totalShots']]),rule('player_shots_on_target',[['shotsOnTarget']]),rule('player_assists',[['goalAssists','assists']])];
 return [];
}
export function aggregateOpponentMarkets(sport:string,teamId:string,boxes:MarketAllowanceBox[],cutoff=Date.now()):MarketAllowanceRow[]{
 const bins=new Map<string,Array<{eventId:string;date:string;value:number}>>(),seen=new Set<string>();
 for(const b of boxes){const c=b.header?.competitions?.[0],id=b.header?.id,date=c?.date;
  if(!id||seen.has(id)||!date||!c?.status?.type?.completed||!Number.isFinite(Date.parse(date))||Date.parse(date)>=cutoff)continue;
  const ids=c.competitors?.map(t=>t.team?.id)??[];if(ids.length!==2||!ids.includes(teamId)||ids[0]===ids[1])continue;
  seen.add(id);
  for(const r of opponentMarketRules(sport)){
   const target=r.scope==='team_allowed'?ids.find(x=>x!==teamId):teamId;
   const teams=b.boxscore?.teams?.filter(t=>t.team?.id===target)??[];if(teams.length!==1)continue;
   let statRows=teams[0]!.statistics??[];
   if(sport==='mlb'){
    const batting=(b.boxscore?.players??[]).filter(p=>p.team?.id===target).flatMap(p=>p.statistics??[]).filter(g=>g.labels?.includes('AB')&&g.labels?.includes('H'));
    if(batting.length!==1)continue;
    const labels=batting[0]!.labels!,totals=batting[0]!.totals??[];
    const fields:Record<string,string>={H:'hits',R:'runs',RBI:'RBIs',HR:'homeRuns',SB:'stolenBases',K:'strikeouts',BB:'walks'};
    statRows=Object.entries(fields).flatMap(([label,name])=>{const i=labels.indexOf(label);return i>=0&&labels.lastIndexOf(label)===i&&totals[i]!=null?[{name,displayValue:totals[i]}]:[];});
   }
   // Explicit ESPN made/attempted pair fields, never inferred from percentages.
   const pair=(name:string,pattern:RegExp,names:string[])=>{const cells=statRows.filter(s=>s.name===name);if(cells.length!==1)return;const match=String(cells[0]!.displayValue??cells[0]!.value??'').match(pattern);if(!match)return;names.forEach((name,i)=>{if(!statRows.some(s=>s.name===name))statRows=[...statRows,{name,value:Number(match[i+1])}];});};
   if(['nba','wnba','ncaab'].includes(sport))pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted',/^(\d+)-(\d+)$/,['threePointFieldGoalsMade','threePointFieldGoalsAttempted']);
   if(['nfl','ncaaf'].includes(sport))pair('completionAttempts',/^(\d+)\/(\d+)$/,['completions','passingAttempts']);
   const values=r.fields.map(keys=>{const entries=statRows.filter(s=>keys.includes(s.name??''));
    if(!entries.length && keys.length===1 && ['points','goals','runs'].includes(keys[0]!)){const score=c.competitors?.find(t=>t.team?.id===target)?.score;if(score!=null)entries.push({name:keys[0],value:score});}
    const numbers=entries.map(s=>s.value??s.displayValue).filter(v=>v!=null&&/^-?\d+(?:\.\d+)?$/.test(String(v))).map(Number);
    return numbers.length===entries.length&&numbers.length&&new Set(numbers).size===1?numbers[0]!:null;});
   if(values.some(v=>v==null||!Number.isFinite(v)||v<0))continue;
   const rows=bins.get(r.market)??[];rows.push({eventId:id,date,value:values.reduce<number>((n,v)=>n+v!,0)});bins.set(r.market,rows);
  }
 }
 return opponentMarketRules(sport).flatMap(r=>{const b=bins.get(r.market);if(!b||b.length<3)return [];b.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));return [{games:b.map(x=>({...x})),market:r.market,perGame:b.reduce((a,b)=>a+b.value,0)/b.length,sampleSize:b.length,firstGame:b[0]!.date,lastGame:b.at(-1)!.date,scope:r.scope,source:'ESPN completed team box scores; full game'}];});
}

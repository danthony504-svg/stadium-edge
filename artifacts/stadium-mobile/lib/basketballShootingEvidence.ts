/** Descriptive box-score arithmetic only; no probability adjustment. */
export function basketballShootingEvidence(games: readonly {stats?:Record<string,string>}[]): string[] {
 const result:string[]=[];
 for(const [label,pairs,madeKeys,attemptKeys] of [
  ['FG',['FG','FGM-A','fieldGoalsMade-fieldGoalsAttempted'],['FGM','fieldGoalsMade'],['FGA','fieldGoalsAttempted']],
  ['3PT',['3PT','3PM-A','threePointFieldGoalsMade-threePointFieldGoalsAttempted'],['3PM','threePointFieldGoalsMade'],['3PA','threePointFieldGoalsAttempted']],
  ['FT',['FT','FTM-A','freeThrowsMade-freeThrowsAttempted'],['FTM','freeThrowsMade'],['FTA','freeThrowsAttempted']],
 ] as const) {
  const rows:Array<[number,number]>=[];
  for(const g of games){
   const stats=g.stats??{},candidates:Array<[number,number]>=[];
   for(const k of pairs){const m=stats[k]?.trim().match(/^(\d+)\s*[-/]\s*(\d+)$/);if(m)candidates.push([Number(m[1]),Number(m[2])]);}
   const values=(keys:readonly string[])=>keys.flatMap(k=>/^\d+$/.test(stats[k]?.trim()??'')?[Number(stats[k])]:[]);
   const made=values(madeKeys),attempts=values(attemptKeys);
   if(new Set(made).size>1||new Set(attempts).size>1)continue;
   if(made.length&&attempts.length)candidates.push([made[0]!,attempts[0]!]);
   if(!candidates.length||new Set(candidates.map(x=>x.join('/'))).size!==1)continue;
   const [m,a]=candidates[0]!;if(m>a||!Number.isSafeInteger(m)||!Number.isSafeInteger(a))continue;
   if(made.some(v=>v!==m)||attempts.some(v=>v!==a))continue;
   rows.push([m,a]);
  }
  if(rows.length<3)continue;
  const made=rows.reduce((s,r)=>s+r[0],0),attempts=rows.reduce((s,r)=>s+r[1],0);
  result.push(`Shooting ${label}: ${made}/${attempts} (${attempts ? (100*made/attempts).toFixed(1)+'%' : 'percentage unavailable'}); ${attempts-made} misses across ${rows.length} logged games. Historical results already include these misses; no additional penalty applied.`);
 }
 return result;
}

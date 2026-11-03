import type {OpponentMarketEvidence} from './opponentMarketGate.ts';
/** Team-scope history only; never presents a team total as one player's result. */
export function opponentThresholdHistory(rows:readonly OpponentMarketEvidence[]|undefined,market:string,line:number,cutoff:number){
 if(!Number.isFinite(line)||!Number.isFinite(cutoff))return null;
 const matches=rows?.filter(r=>r.market===market.replace(/_alternate$/,''))??[];
 if(matches.length!==1)return null;
 const row=matches[0]!,games=row.games;
 if(!row.source||!["team_allowed","team_offensive_exposure"].includes(row.scope)||!Number.isSafeInteger(row.sampleSize))return null;
 if(!games||games.length<3||games.length!==row.sampleSize)return null;
 const ids=new Set<string>();
 for(const g of games){if(!g.eventId||ids.has(g.eventId)||!Number.isFinite(g.value)||g.value<0||!Number.isFinite(Date.parse(g.date))||Date.parse(g.date)>=cutoff)return null;ids.add(g.eventId);}
 return {total:games.length,over:games.filter(g=>g.value>line).length,under:games.filter(g=>g.value<line).length,pushes:games.filter(g=>g.value===line).length,scope:row.scope};
}

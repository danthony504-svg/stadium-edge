/** Offline replay. Source provenance still requires independent review. */
import type {CfbdGame} from "./cfbdHistory.js";
import {runNcaafFullGameCandidate,NCAAF_FULL_GAME_CANDIDATE_VERSION} from "./sportSim/ncaafFullGameCandidate.js";
export type TimedGame=CfbdGame&{completedAt:string;observedAt:string;source:string;ruleset:string};
export type ReplayQuote={season:number;eventId:string;bookmaker:string;market:"ml"|"spread"|"total";line:number|null;firstPrice:number;secondPrice:number;observedAt:string;settlement:"full_game_including_overtime"};
export type ForecastJournal={season:number;eventId:string;forecastAt:string;inputCutoffAt:string;injurySourceTimestamp:string|null;ruleset:string};
export type FullGameReplayArchive={version:1;games:TimedGame[];forecasts:ForecastJournal[];quotes:ReplayQuote[]};
const key=(x:{season:number;eventId:string})=>`${x.season}:${x.eventId}`;
const time=(x:string)=>Date.parse(x),validTime=(x:unknown):x is string=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const canon=(x:object)=>JSON.stringify(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)));
const validPrice=(x:number)=>Number.isFinite(x)&&Math.abs(x)>=100;
const implied=(x:number)=>x<0?-x/(-x+100):100/(x+100);
export function readFullGameReplayArchive(raw:unknown):FullGameReplayArchive{
 const a=raw as FullGameReplayArchive;
 if(!a||a.version!==1||!Array.isArray(a.games)||!Array.isArray(a.forecasts)||!Array.isArray(a.quotes))throw Error("fullgame_invalid_archive");
 const games=new Map<string,TimedGame>(),forecasts=new Map<string,ForecastJournal>(),quotes=new Map<string,ReplayQuote>();
 for(const g of a.games){
  if(!g||!Number.isSafeInteger(g.season)||!/^\d+$/.test(g.eventId)||!/^\d+$/.test(g.homeId)||!/^\d+$/.test(g.awayId)||g.homeId===g.awayId||
   ![g.homePoints,g.awayPoints].every(x=>Number.isSafeInteger(x)&&x>=0)||g.homePoints===g.awayPoints||![true,false,null].includes(g.overtime)||
   ![g.kickoff,g.completedAt,g.observedAt].every(validTime)||time(g.completedAt)<=time(g.kickoff)||time(g.observedAt)<time(g.completedAt)||!g.source?.trim()||!g.ruleset?.trim())throw Error("fullgame_invalid_game_evidence");
  const h=g.regulationHomePoints,a=g.regulationAwayPoints;
  if((h!=null||a!=null)&&(![h,a].every(x=>Number.isSafeInteger(x)&&x!>=0)||h!>g.homePoints||a!>g.awayPoints||(g.overtime===true&&h!==a)||(g.overtime===false&&(h!==g.homePoints||a!==g.awayPoints))))throw Error("fullgame_invalid_regulation_scores");
  const prior=games.get(key(g));if(prior&&canon(prior)!==canon(g))throw Error("fullgame_conflicting_game");games.set(key(g),g);
 }
 for(const f of a.forecasts){const g=f&&games.get(key(f));if(!g||![f.forecastAt,f.inputCutoffAt].every(validTime)||time(f.inputCutoffAt)>time(f.forecastAt)||time(f.forecastAt)>=time(g.kickoff)||f.ruleset!==g.ruleset||(f.injurySourceTimestamp!==null&&(!validTime(f.injurySourceTimestamp)||time(f.injurySourceTimestamp)>time(f.forecastAt))))throw Error("fullgame_invalid_forecast_journal");if(forecasts.has(key(f)))throw Error("fullgame_duplicate_forecast");forecasts.set(key(f),f);}
 for(const q of a.quotes){const f=q&&forecasts.get(key(q));if(!f||!q.bookmaker?.trim()||!["ml","spread","total"].includes(q.market)||q.settlement!=="full_game_including_overtime"||!validPrice(q.firstPrice)||!validPrice(q.secondPrice)||!validTime(q.observedAt)||time(q.observedAt)>time(f.forecastAt)||(q.market==="ml"?q.line!==null:!Number.isFinite(q.line))||(q.market==="total"&&q.line!<0))throw Error("fullgame_invalid_quote");const k=JSON.stringify([key(q),q.bookmaker,q.market]),prior=quotes.get(k);if(prior&&canon(prior)!==canon(q))throw Error("fullgame_ambiguous_quote");quotes.set(k,q);}
 return {version:1,games:[...games.values()],forecasts:[...forecasts.values()],quotes:[...quotes.values()]};
}
export function priorRegulationTeamSample(games:TimedGame[],target:TimedGame,f:ForecastJournal,id:string){
 const rows=games.filter(g=>g.season===target.season&&key(g)!==key(target)&&time(g.observedAt)<=time(f.inputCutoffAt)&&time(g.completedAt)<time(f.forecastAt)&&(g.homeId===id||g.awayId===id)&&(g.overtime===false||(g.overtime===true&&g.regulationHomePoints!=null&&g.regulationAwayPoints!=null)));
 if(rows.length<3)return null;
 const points=(g:TimedGame,own:boolean)=>{const h=g.overtime?g.regulationHomePoints!:g.homePoints,a=g.overtime?g.regulationAwayPoints!:g.awayPoints;return g.homeId===id?(own?h:a):(own?a:h);};
 return {games:rows.length,ptsFor:rows.reduce((s,g)=>s+points(g,true),0)/rows.length,ptsAgainst:rows.reduce((s,g)=>s+points(g,false),0)/rows.length};
}
export function runFullGameReplay(raw:unknown){
 const a=readFullGameReplayArchive(raw),byGame=new Map(a.games.map(g=>[key(g),g]));
 const excluded={missingInjuryEvidence:0,thinTeamHistory:0,insufficientOvertimeEvidence:0},predictions=[];
 type Metric={season:number;bookmaker:string;market:string;games:number;pushes:number;modelBrier:number;marketBrier:number;bins:{count:number;sum:number;hits:number}[]};
 const groups=new Map<string,Metric>();
 for(const f of [...a.forecasts].sort((a,b)=>time(a.forecastAt)-time(b.forecastAt)||key(a).localeCompare(key(b)))){
  const target=byGame.get(key(f))!;
  if(!f.injurySourceTimestamp){excluded.missingInjuryEvidence++;continue;}
  const home=priorRegulationTeamSample(a.games,target,f,target.homeId),away=priorRegulationTeamSample(a.games,target,f,target.awayId);if(!home||!away){excluded.thinTeamHistory++;continue;}
  const overtimeHistory=a.games.filter(g=>key(g)!==key(target)&&g.ruleset===f.ruleset&&g.overtime===true&&g.regulationHomePoints!=null&&g.regulationAwayPoints!=null&&time(g.observedAt)<=time(f.inputCutoffAt)&&time(g.observedAt)<time(f.forecastAt)).map(g=>({gameId:key(g),ruleset:g.ruleset,completedAt:g.completedAt,observedAt:g.observedAt,regulationHome:g.regulationHomePoints!,regulationAway:g.regulationAwayPoints!,finalHome:g.homePoints,finalAway:g.awayPoints}));
  const result=runNcaafFullGameCandidate({home,away,seed:Number(target.eventId)>>>0,forecastAt:f.forecastAt,kickoff:target.kickoff,ruleset:f.ruleset,overtimeHistory});if(!result){excluded.insufficientOvertimeEvidence++;continue;}
  const markets=[];
  for(const q of a.quotes.filter(q=>key(q)===key(target))){
   // first side means home for ML/spread, Over for totals.
   const value=(h:number,aw:number)=>q.market==="ml"?h-aw:q.market==="spread"?h-aw+q.line!:h+aw-q.line!;
   const actual=value(target.homePoints,target.awayPoints);let wins=0,losses=0,pushes=0;
   for(let i=0;i<result.draws;i++){const v=value(result.homeScores[i]!,result.awayScores[i]!);if(v>0)wins++;else if(v<0)losses++;else pushes++;}
   const p=wins+losses?wins/(wins+losses):null,first=implied(q.firstPrice),second=implied(q.secondPrice),baseline=first/(first+second);
   const k=JSON.stringify([target.season,q.bookmaker,q.market]);let m=groups.get(k);if(!m){m={season:target.season,bookmaker:q.bookmaker,market:q.market,games:0,pushes:0,modelBrier:0,marketBrier:0,bins:Array.from({length:10},()=>({count:0,sum:0,hits:0}))};groups.set(k,m);}
   markets.push({bookmaker:q.bookmaker,market:q.market,line:q.line,firstPrice:q.firstPrice,secondPrice:q.secondPrice,conditionalWinProbability:p,winProbability:wins/result.draws,pushProbability:pushes/result.draws,marketProbability:baseline,actual:actual>0?"win":actual<0?"loss":"push"});
   if(actual===0){m.pushes++;continue;}if(p===null)continue;const hit=actual>0?1:0;m.games++;m.modelBrier+=(p-hit)**2;m.marketBrier+=(baseline-hit)**2;const bin=m.bins[Math.min(9,Math.floor(p*10))]!;bin.count++;bin.sum+=p;bin.hits+=hit;
  }
  predictions.push({eventId:target.eventId,season:target.season,modelVersion:result.version,settlement:result.settlement,forecastAt:f.forecastAt,inputCutoffAt:f.inputCutoffAt,homeMean:result.homeMean,awayMean:result.awayMean,homeActual:target.homePoints,awayActual:target.awayPoints,homeSampleGames:home.games,awaySampleGames:away.games,overtimeEvidenceGames:result.overtimeEvidenceGames,markets});
 }
 return {version:NCAAF_FULL_GAME_CANDIDATE_VERSION,productionReady:false,validationReady:false,forecasts:a.forecasts.length,scored:predictions.length,excluded,cohorts:[...groups.values()].map(m=>({season:m.season,bookmaker:m.bookmaker,market:m.market,games:m.games,pushes:m.pushes,modelBrier:m.games?m.modelBrier/m.games:null,marketBrier:m.games?m.marketBrier/m.games:null,probabilityBins:m.bins.map(b=>({games:b.count,meanProbability:b.count?b.sum/b.count:null,actualRate:b.count?b.hits/b.count:null}))})),predictions,limitations:["research_only_no_automatic_release","source_timestamp_assertions_require_independent_review","injury_opponent_venue_effects_not_calibrated"]};
}

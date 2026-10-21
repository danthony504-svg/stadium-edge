/** Offline exploratory regulation evaluation; never authorizes picks. */
import type {CfbdGame} from './cfbdHistory.js';
import {runNcaafCandidate,NCAAF_CANDIDATE_VERSION} from './sportSim/ncaafCandidate.js';
export function readBacktestGames(snapshots:unknown[]):CfbdGame[]{
 const byId=new Map<string,CfbdGame>();
 for(const raw of snapshots){
  const s=raw as {year:number;week:number;games:CfbdGame[]};
  if(!s||![2024,2025].includes(s.year)||!Number.isInteger(s.week)||s.week<1||s.week>16||!Array.isArray(s.games))throw Error('backtest_invalid_snapshot');
  for(const g of s.games){
   if(!g||g.season!==s.year||!/^\d+$/.test(g.eventId)||!/^\d+$/.test(g.homeId)||!/^\d+$/.test(g.awayId)||g.homeId===g.awayId||!Number.isFinite(Date.parse(g.kickoff))||![g.homePoints,g.awayPoints].every(x=>Number.isInteger(x)&&x>=0)||![true,false,null].includes(g.overtime))throw Error('backtest_invalid_game');
   const key=`${g.season}:${g.eventId}`,prior=byId.get(key);
   if(prior&&['kickoff','homeId','awayId','homePoints','awayPoints','overtime'].some(k=>prior[k as keyof CfbdGame]!==g[k as keyof CfbdGame]))throw Error('backtest_conflicting_game');
   byId.set(key,g);
  }
 }
 return [...byId.values()].sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)||a.eventId.localeCompare(b.eventId));
}
/** 24h lag is a completion proxy, not verified historical availability. */
export function priorTeamSample(games:CfbdGame[],target:CfbdGame,teamId:string){
 const rows=games.filter(g=>g.season===target.season&&g.eventId!==target.eventId&&g.overtime===false&&Date.parse(g.kickoff)+86400000<Date.parse(target.kickoff)&&(g.homeId===teamId||g.awayId===teamId));
 if(rows.length<3)return null;
 const pts=(g:CfbdGame,own:boolean)=>g.homeId===teamId?(own?g.homePoints:g.awayPoints):(own?g.awayPoints:g.homePoints);
 return {games:rows.length,ptsFor:rows.reduce((n,g)=>n+pts(g,true),0)/rows.length,ptsAgainst:rows.reduce((n,g)=>n+pts(g,false),0)/rows.length};
}
export function runNcaafBacktest(games:CfbdGame[]){
 const reports=[2024,2025].map(season=>{
  let scored=0,thinHistory=0,overtime=0,unknownOvertime=0,invalidCandidate=0,totalError=0,marginError=0;
  for(const g of games.filter(g=>g.season===season)){
   if(g.overtime===null){unknownOvertime++;continue;}if(g.overtime){overtime++;continue;}
   const home=priorTeamSample(games,g,g.homeId),away=priorTeamSample(games,g,g.awayId);
   if(!home||!away){thinHistory++;continue;}
   const result=runNcaafCandidate({home,away,seed:Number(g.eventId)>>>0,simulations:10000});
   if(!result){invalidCandidate++;continue;}
   scored++;totalError+=Math.abs(result.homeMean+result.awayMean-g.homePoints-g.awayPoints);
   marginError+=Math.abs(result.homeMean-result.awayMean-g.homePoints+g.awayPoints);
  }
  const avg=(x:number)=>scored?Number((x/scored).toFixed(4)):null;
  return {season,role:season===2024?'development':'holdout',games:games.filter(g=>g.season===season).length,scored,excluded:{thinHistory,overtime,unknownOvertime,invalidCandidate},totalMAE:avg(totalError),marginMAE:avg(marginError)};
 });
 return {version:NCAAF_CANDIDATE_VERSION,simulationsPerGame:10000,settlement:'regulation_only',productionReady:false,validationReady:false,reports,limitations:['exploratory_score_error_only','completion_time_unverified_24h_kickoff_proxy','historical_data_revision_availability_unverified','overtime_and_unknown_overtime_excluded','no_injury_or_matchup_adjustments','quote_timestamps_unverified_no_market_performance_claim','no_probability_calibration_or_roi_validation']};
}

/** Isolated research candidate. No production registration or release authority. */
import {runNcaafCandidate,type CandidateInput} from "./ncaafCandidate.js";
export const NCAAF_FULL_GAME_CANDIDATE_VERSION="ncaaf-observed-ot-research-v1";
export const MIN_OVERTIME_EVIDENCE=30;
export type ObservedOvertimeGame={gameId:string;ruleset:string;completedAt:string;observedAt:string;regulationHome:number;regulationAway:number;finalHome:number;finalAway:number};
export type FullGameCandidateInput=CandidateInput&{forecastAt:string;kickoff:string;ruleset:string;overtimeHistory:ObservedOvertimeGame[]};
export function runNcaafFullGameCandidate(input:FullGameCandidateInput){
 const forecast=Date.parse(input.forecastAt),kickoff=Date.parse(input.kickoff);
 if(!Number.isFinite(forecast)||!Number.isFinite(kickoff)||forecast>=kickoff||!input.ruleset.trim())return null;
 const byId=new Map<string,ObservedOvertimeGame>();
 const canonical=(g:ObservedOvertimeGame)=>JSON.stringify([g.gameId,g.ruleset,g.completedAt,g.observedAt,g.regulationHome,g.regulationAway,g.finalHome,g.finalAway]);
 for(const g of input.overtimeHistory){
  if(!g.gameId.trim()||g.ruleset!==input.ruleset||![g.regulationHome,g.regulationAway,g.finalHome,g.finalAway].every(v=>Number.isSafeInteger(v)&&v>=0)||
   g.regulationHome!==g.regulationAway||g.finalHome===g.finalAway||g.finalHome<g.regulationHome||g.finalAway<g.regulationAway||
   !Number.isFinite(Date.parse(g.completedAt))||!Number.isFinite(Date.parse(g.observedAt))||Date.parse(g.completedAt)>Date.parse(g.observedAt)||Date.parse(g.observedAt)>=forecast)return null;
  const prior=byId.get(g.gameId);if(prior&&canonical(prior)!==canonical(g))return null;byId.set(g.gameId,g);
 }
 if(byId.size<MIN_OVERTIME_EVIDENCE)return null;
 const evidence=[...byId.values()].sort((a,b)=>a.gameId.localeCompare(b.gameId)),reg=runNcaafCandidate(input);if(!reg)return null;
 let state=(input.seed^0x9e3779b9)>>>0,overtimeDraws=0;
 const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const homeScores=[...reg.homeScores],awayScores=[...reg.awayScores];
 for(let i=0;i<reg.draws;i++)if(homeScores[i]===awayScores[i]){const g=evidence[Math.floor(random()*evidence.length)]!;homeScores[i]!+=g.finalHome-g.regulationHome;awayScores[i]!+=g.finalAway-g.regulationAway;overtimeDraws++;}
 const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
 return {version:NCAAF_FULL_GAME_CANDIDATE_VERSION,settlement:"full_game_including_overtime" as const,draws:reg.draws,homeScores,awayScores,homeMean:mean(homeScores),awayMean:mean(awayScores),overtimeDraws,overtimeEvidenceGames:evidence.length,productionReady:false as const,limitations:["empirical_ot_bootstrap_not_possession_model","held_out_calibration_required","injury_venue_and_opponent_validation_required"]};
}

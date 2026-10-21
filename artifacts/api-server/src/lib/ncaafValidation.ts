/** Offline forecast-journal audit. Never imported by live Coach. */
export type NcaafForecast = {
 eventId:string;season:number;market:"ml"|"spread"|"total"|"team_total";
 quoteId:string;book:string;line:number|null;selection:string;sourceUrl:string;
 predictedAt:string;historyCutoff:string;kickoff:string;settledAt:string;
 prediction:number;marketProbability:number;outcome:0|1|null;
 modelVersion:string;settlement:"regulation_only"|"full_game";
};
function metrics(rows:NcaafForecast[],field:"prediction"|"marketProbability") {
 if(!rows.length)return null;
 const brier=rows.reduce((n,r)=>n+(r[field]-r.outcome!)**2,0)/rows.length;
 const logLoss=rows.reduce((n,r)=>{const p=Math.max(1e-9,Math.min(1-1e-9,r[field]));return n-(r.outcome!*Math.log(p)+(1-r.outcome!)*Math.log(1-p));},0)/rows.length;
 const bins=Array.from({length:10},(_,i)=>{const b=rows.filter(r=>Math.min(9,Math.floor(r[field]*10))===i);return {lower:i/10,count:b.length,predicted:b.length?b.reduce((n,r)=>n+r[field],0)/b.length:null,observed:b.length?b.reduce((n,r)=>n+r.outcome!,0)/b.length:null};});
 const calibrationError=bins.reduce((n,b)=>n+(b.count?b.count/rows.length*Math.abs(b.predicted!-b.observed!):0),0);
 return {brier,logLoss,calibrationError,bins};
}
export function auditNcaafForecasts(rows:NcaafForecast[]) {
 const accepted:NcaafForecast[]=[],rejected:Record<string,number>={},seen=new Set<string>();
 const reject=(why:string)=>{rejected[why]=(rejected[why]??0)+1;};
 for(const r of rows){
  const predicted=Date.parse(r.predictedAt),cutoff=Date.parse(r.historyCutoff),kickoff=Date.parse(r.kickoff),settled=Date.parse(r.settledAt);
  if(!r.eventId||!r.quoteId||!r.book||!r.selection||!/^https:\/\//.test(r.sourceUrl)||!r.modelVersion||!Number.isInteger(r.season)||!["ml","spread","total","team_total"].includes(r.market)){reject("missing_provenance");continue;}
  if(![predicted,cutoff,kickoff,settled].every(Number.isFinite)||cutoff>predicted||predicted>=kickoff||settled<=kickoff){reject("time_leakage_or_missing_time");continue;}
  if(r.market!=="ml"&&(r.line==null||!Number.isFinite(r.line))){reject("missing_exact_line");continue;}
  if(![r.prediction,r.marketProbability].every(v=>Number.isFinite(v)&&v>0&&v<1)){reject("invalid_probability");continue;}
  // Pushes/voids are reported separately; never score them as losses.
  if(r.outcome==null){reject("push_or_void");continue;}
  if(r.outcome!==0&&r.outcome!==1){reject("invalid_outcome");continue;}
  if(r.settlement!=="full_game"){reject("regulation_candidate_not_full_game");continue;}
  const key=[r.eventId,r.market,r.selection,r.line,r.modelVersion].join(":");
  if(seen.has(key)){reject("duplicate_forecast");continue;}seen.add(key);accepted.push(r);
 }
 const events=new Set(accepted.map(r=>r.eventId)).size,seasons=[...new Set(accepted.map(r=>r.season))].sort();
 return {version:1,records:rows.length,accepted:accepted.length,events,seasons,rejected,candidate:metrics(accepted,"prediction"),marketBaseline:metrics(accepted,"marketProbability"),byMarket:Object.fromEntries(["ml","spread","total","team_total"].map(m=>{const group=accepted.filter(r=>r.market===m);return [m,{count:group.length,candidate:metrics(group,"prediction"),marketBaseline:metrics(group,"marketProbability")}];})),
  // Statistical report does not independently approve a model or alter P0.
  productionReady:false,blockers:[...(events?[]:["no_usable_frozen_forecasts"]),...(seasons.length>=2?[]:["multi_season_holdout_missing"]),"overtime_model_validation_required","injury_and_matchup_validation_required","acceptance_tolerances_and_review_required"]};
}

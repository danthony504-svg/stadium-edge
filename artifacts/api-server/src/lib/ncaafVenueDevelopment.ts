/** Offline 2024 venue experiment; never used by Coach. */
import type {CfbdGame} from './cfbdHistory.js';
import {opponentScoreMeans} from './ncaafOpponentResearch.js';
import {compareMarketLines,type BaselineQuote,type ScorePrediction} from './ncaafMarketBaseline.js';
export function readVenueFlags(raw:unknown,games:CfbdGame[]){
 const report=raw as {version?:number;source?:string;metadata?:unknown[]};
 if(report?.version!==1||report.source!=='cfbd'||!Array.isArray(report.metadata))throw Error('venue_invalid_sidecar');
 const archived=new Map(games.filter(g=>g.season===2024).map(g=>[g.eventId,g]));
 const flags=new Map<string,boolean|null>();
 for(const value of report.metadata){
  const r=value as CfbdGame&{neutralSite:unknown};const g=archived.get(r?.eventId);
  if(!g||r.season!==2024||r.homeId!==g.homeId||r.awayId!==g.awayId||Date.parse(r.kickoff)!==Date.parse(g.kickoff)||![true,false,null].includes(r.neutralSite as null))throw Error('venue_sidecar_identity_mismatch');
  if(flags.has(r.eventId))throw Error('venue_duplicate_sidecar_event');
  flags.set(r.eventId,r.neutralSite as boolean|null);
 }
 return flags;
}
/** Venue coefficient is a margin effect: +h/2 home, -h/2 away; zero at neutral sites. */
export function venueScoreMeans(games:CfbdGame[],target:CfbdGame,flags:Map<string,boolean|null>){
 if(target.season!==2024||typeof flags.get(target.eventId)!=='boolean')return null;
 const prior=games.filter(g=>g.season===2024&&g.eventId!==target.eventId&&g.overtime===false&&typeof flags.get(g.eventId)==='boolean'&&Date.parse(g.kickoff)+86400000<Date.parse(target.kickoff)).sort((a,b)=>a.eventId.localeCompare(b.eventId));
 if([target.homeId,target.awayId].some(t=>prior.filter(g=>g.homeId===t||g.awayId===t).length<3))return null;
 const rows=prior.flatMap(g=>{const x=flags.get(g.eventId)?0:0.5;return [{team:g.homeId,opp:g.awayId,points:g.homePoints,x},{team:g.awayId,opp:g.homeId,points:g.awayPoints,x:-x}];});
 const base=rows.reduce((n,r)=>n+r.points,0)/rows.length;
 const teams=[...new Set(rows.flatMap(r=>[r.team,r.opp]))].sort();
 const attack=new Map(teams.map(t=>[t,0])),defense=new Map(teams.map(t=>[t,0]));
 const offenseRows=new Map(teams.map(t=>[t,rows.filter(r=>r.team===t)])),defenseRows=new Map(teams.map(t=>[t,rows.filter(r=>r.opp===t)]));
 let homeField=0;
 for(let i=0;i<100;i++){
  for(const t of teams){const rr=offenseRows.get(t)!;attack.set(t,rr.reduce((n,r)=>n+r.points-base-defense.get(r.opp)!-homeField*r.x,0)/(rr.length+4));}
  for(const t of teams){const rr=defenseRows.get(t)!;defense.set(t,rr.reduce((n,r)=>n+r.points-base-attack.get(r.team)!-homeField*r.x,0)/(rr.length+4));}
  homeField=rows.reduce((n,r)=>n+r.x*(r.points-base-attack.get(r.team)!-defense.get(r.opp)!),0)/(rows.reduce((n,r)=>n+r.x*r.x,0)+4);
 }
 const x=flags.get(target.eventId)?0:0.5;
 const home=base+attack.get(target.homeId)!+defense.get(target.awayId)!+homeField*x,away=base+attack.get(target.awayId)!+defense.get(target.homeId)!-homeField*x;
 if(![home,away].every(n=>Number.isFinite(n)&&n>=0&&n<=84))return null;
 return {home,away,homeFieldMargin:homeField,appliedMargin:homeField*x*2,priorGames:prior.length};
}
export function runVenueDevelopment(games:CfbdGame[],quotes:BaselineQuote[],flags:Map<string,boolean|null>){
 const development=games.filter(g=>g.season===2024),known=development.filter(g=>typeof flags.get(g.eventId)==='boolean');
 const baseline:ScorePrediction[]=[],venue:ScorePrediction[]=[];
 const excluded={overtime:0,unknownOvertime:0,unknownVenue:0,thinHistory:0,invalidPrediction:0};
 let neutralScored=0;
 for(const g of development){
  if(g.overtime===null){excluded.unknownOvertime++;continue;}if(g.overtime){excluded.overtime++;continue;}
  if(typeof flags.get(g.eventId)!=='boolean'){excluded.unknownVenue++;continue;}
  const prior=known.filter(p=>p.eventId!==g.eventId&&p.overtime===false&&Date.parse(p.kickoff)+86400000<Date.parse(g.kickoff));
  if([g.homeId,g.awayId].some(t=>prior.filter(p=>p.homeId===t||p.awayId===t).length<3)){excluded.thinHistory++;continue;}
  const a=opponentScoreMeans(known,g),b=venueScoreMeans(known,g,flags);
  if(!a||!b){excluded.invalidPrediction++;continue;}
  baseline.push({game:g,total:a.home+a.away,margin:a.home-a.away});venue.push({game:g,total:b.home+b.away,margin:b.home-b.away});if(flags.get(g.eventId))neutralScored++;
 }
 const metrics=(rows:ScorePrediction[])=>{const avg=(f:(p:ScorePrediction)=>number)=>rows.length?Number((rows.reduce((n,p)=>n+f(p),0)/rows.length).toFixed(4)):null;return {totalMAE:avg(p=>Math.abs(p.total-p.game.homePoints-p.game.awayPoints)),marginMAE:avg(p=>Math.abs(p.margin-p.game.homePoints+p.game.awayPoints)),bookmakerComparison:compareMarketLines(rows,quotes,2024)};};
 return {version:'ncaaf-venue-ridge-dev-v1',season:2024,role:'development_only',parameters:{ridge:4,venueRidge:4,iterations:100,minimumTeamGames:3,kickoffLagHours:24},games:development.length,pairedGames:venue.length,neutralScored,excluded,opponentOnly:metrics(baseline),opponentWithVenue:metrics(venue),productionReady:false,validationReady:false,limitations:['2024_exploratory_expected_scores_only','fixed_experimental_parameters_not_validated','retrospective_venue_and_data_availability_unverified','24h_completion_proxy_not_verified_completion','non_ot_selection_bias','book_lines_not_verified_pregame_or_closing','no_injury_probability_or_roi_validation','2025_not_evaluated']};
}

/** Retrospective metadata sidecar only; does not alter archives or authorize picks. */
import type {CfbdGame} from './cfbdHistory.js';
export function matchVenueMetadata(games:CfbdGame[],raw:unknown,weeks:Map<string,number>){
 if(!Array.isArray(raw))throw Error('venue_invalid_response');
 const byId=new Map<string,Record<string,unknown>>();
 for(const row of raw){
  if(!row||typeof row!=='object')throw Error('venue_invalid_response');
  const r=row as Record<string,unknown>,id=String(r.id);
  const prior=byId.get(id);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(r))throw Error('venue_conflicting_event');
  byId.set(id,r);
 }
 const rejected={missingEvent:0,identityMismatch:0,unknownNeutralSite:0};
 const metadata=[];
 for(const g of games){
  if(g.season!==2024)throw Error('venue_2024_only');
  const r=byId.get(g.eventId);
  if(!r){rejected.missingEvent++;continue;}
  if(r.season!==2024||r.week!==weeks.get(g.eventId)||r.seasonType!=='regular'||String(r.homeId)!==g.homeId||String(r.awayId)!==g.awayId||Date.parse(String(r.startDate))!==Date.parse(g.kickoff)){rejected.identityMismatch++;continue;}
  const neutralSite=typeof r.neutralSite==='boolean'?r.neutralSite:null;
  if(neutralSite===null)rejected.unknownNeutralSite++;
  metadata.push({eventId:g.eventId,season:2024,week:weeks.get(g.eventId),homeId:g.homeId,awayId:g.awayId,kickoff:g.kickoff,neutralSite,venueId:typeof r.venueId==='number'&&Number.isSafeInteger(r.venueId)&&r.venueId>0?String(r.venueId):null,venue:typeof r.venue==='string'&&r.venue.trim()?r.venue:null});
 }
 return {metadata,rejected,archivedGames:games.length,matchedGames:metadata.length,knownNeutralSite:metadata.filter(x=>x.neutralSite!==null).length,neutralGames:metadata.filter(x=>x.neutralSite===true).length};
}

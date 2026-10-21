import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchVenueMetadata} from '../src/lib/ncaafVenueMetadata.js';
const game={eventId:'1',season:2024,kickoff:'2024-09-01T00:00:00Z',homeId:'2',awayId:'3',homePoints:21,awayPoints:14,overtime:false};
const row={id:1,season:2024,week:1,seasonType:'regular',homeId:2,awayId:3,startDate:game.kickoff,neutralSite:true,venueId:null};
const weeks=new Map([['1',1]]);
test('preserves neutral status even without a venue; leaves input untouched',()=>{const before=JSON.stringify(game);const r=matchVenueMetadata([game],[row],weeks);assert.equal(r.neutralGames,1);assert.equal(r.metadata[0].venueId,null);assert.equal(JSON.stringify(game),before);});
test('rejects mismatched identities and reports absent events',()=>{for(const patch of [{homeId:9},{awayId:9},{week:2},{season:2025},{startDate:'2024-09-02T00:00:00Z'},{seasonType:'postseason'}])assert.equal(matchVenueMetadata([game],[{...row,...patch}],weeks).rejected.identityMismatch,1);assert.equal(matchVenueMetadata([game],[],weeks).rejected.missingEvent,1);});
test('unknown neutral status remains null and conflicting source records fail',()=>{assert.equal(matchVenueMetadata([game],[{...row,neutralSite:undefined}],weeks).metadata[0].neutralSite,null);assert.throws(()=>matchVenueMetadata([game],[row,{...row,neutralSite:false}],weeks),/venue_conflicting_event/);assert.throws(()=>matchVenueMetadata([{...game,season:2025}],[row],weeks),/venue_2024_only/);});

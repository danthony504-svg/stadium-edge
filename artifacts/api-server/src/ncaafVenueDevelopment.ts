import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readBacktestGames} from './lib/ncaafBacktest.js';
import {readBaselineQuotes} from './lib/ncaafMarketBaseline.js';
import {readVenueFlags,runVenueDevelopment} from './lib/ncaafVenueDevelopment.js';
try{
 const [inputPath,venuePath]=process.argv.slice(2);if(!inputPath||!venuePath)throw Error('venue_input_and_metadata_required');
 const input=await readFile(inputPath,'utf8'),metadata=await readFile(venuePath,'utf8');if(input.length>12000000||metadata.length>12000000)throw Error('venue_input_too_large');
 const snapshots=input.split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s)).filter(s=>s.year===2024);
 const games=readBacktestGames(snapshots);if(!games.length)throw Error('venue_2024_required');
 const flags=readVenueFlags(JSON.parse(metadata),games);
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 console.log(JSON.stringify({...runVenueDevelopment(games,readBaselineQuotes(snapshots),flags),developmentInputSha256:hash(JSON.stringify(snapshots)),venueInputSha256:hash(metadata)},null,2));
}catch(e){const m=e instanceof Error?e.message:'';console.error(/^(venue|backtest)_[a-z_]+$/.test(m)?m:'venue_input_or_run_error');process.exitCode=1;}

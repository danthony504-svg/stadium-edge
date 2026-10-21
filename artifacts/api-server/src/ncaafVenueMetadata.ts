import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readBacktestGames} from './lib/ncaafBacktest.js';
import {matchVenueMetadata} from './lib/ncaafVenueMetadata.js';
try{
 const [inputPath,outputPath]=process.argv.slice(2);
 if(!inputPath||!outputPath)throw Error('venue_input_and_output_required');
 const input=await readFile(inputPath,'utf8');if(input.length>12000000)throw Error('venue_input_too_large');
 const snapshots=input.split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x)).filter(x=>x.year===2024);
 const games=readBacktestGames(snapshots);if(!games.length)throw Error('venue_2024_required');
 const weeks=new Map<string,number>();
 for(const s of snapshots)for(const g of s.games){if(weeks.has(g.eventId)&&weeks.get(g.eventId)!==s.week)throw Error('venue_conflicting_week');weeks.set(g.eventId,s.week);}
 const key=process.env.CFBD_API_KEY?.trim();if(!key)throw Error('venue_key_not_configured');
 const response=await fetch('https://api.collegefootballdata.com/games?year=2024&seasonType=regular&classification=fbs',{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!response.ok)throw Error(`venue_http_${response.status}`);
 const body=await response.text();if(body.length>12000000)throw Error('venue_response_too_large');
 const result=matchVenueMetadata(games,JSON.parse(body),weeks);
 const report={version:1,source:'cfbd',observedAt:new Date().toISOString(),inputSha256:createHash('sha256').update(input).digest('hex'),responseSha256:createHash('sha256').update(body).digest('hex'),...result,productionReady:false,validationReady:false,limitations:['retrospective_metadata_not_verified_asof_kickoff','unknown_neutral_site_not_assumed_home','research_sidecar_only_no_archive_mutation']};
 await writeFile(outputPath,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 const {metadata,...summary}=report;console.log(JSON.stringify({...summary,outputPath},null,2));
}catch(e){const message=e instanceof Error?e.message:'';console.error(/^venue_[a-z_0-9]+$/.test(message)?message:'venue_collection_or_output_error');process.exitCode=1;}

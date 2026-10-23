/** Recover explicitly audited OT events. Research writes only; never grants release. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {summaryHistory, mergeGames} from './ncaaf-repair-team-history.mjs';

export function recoveryPlan(season, events, now = new Date().toISOString()) {
  if (!Number.isSafeInteger(season) || season < 2021 ||
      !Number.isFinite(Date.parse(now)) || season > new Date(now).getUTCFullYear())
    throw Error('recovery_invalid_season');
  if (!Array.isArray(events) || !events.length || events.length > 32 ||
      events.some(id => typeof id !== 'string' || !/^\d+$/.test(id)) ||
      new Set(events).size !== events.length) throw Error('recovery_invalid_events');
  return {season, events: [...events], maximumRequests: events.length,
    paidOddsRequests: 0, automaticUnlock: false};
}
export function recoverOvertime(raw, eventId, season, startedAt, receivedAt) {
  const archive = summaryHistory(raw, eventId, season, startedAt, receivedAt);
  if (archive.games.length !== 1 || archive.games[0].overtime !== true)
    throw Error('recovery_not_verified_overtime');
  // No inferred historic availability, compatibility declaration or synthetic score.
  return archive;
}
async function main() {
  const option = name => {const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  const plan = recoveryPlan(Number(option('--season')), (option('--events') ?? '').split(','));
  console.log(JSON.stringify({planOnly:!process.argv.includes('--execute'),...plan}));
  if (!process.argv.includes('--execute')) return;
  if (!process.env.DATABASE_URL) throw Error('recovery_database_missing');
  const requireDb=createRequire(resolve(process.env.NCAAF_REPO_ROOT ?? '/opt/render/project/src','lib/db/package.json'));
  const {Client}=requireDb('pg');
  const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,query_timeout:15000});
  await db.connect();
  let locked=false, transaction=false;
  try {
    if ((await db.query('SELECT current_database() AS name')).rows[0].name !== 'stadium_edge_production')
      throw Error('recovery_unexpected_database');
    locked=(await db.query('SELECT pg_try_advisory_lock(64233,20261027) AS acquired')).rows[0].acquired;
    if (!locked) throw Error('recovery_history_writer_running');
    const base=(await db.query('SELECT key,value FROM public.app_kv WHERE key LIKE $1 ORDER BY key DESC LIMIT 1',
      [`research:ncaaf:history-summary:${plan.season}:%`])).rows[0];
    if (!base || !Array.isArray(base.value.games)) throw Error('recovery_history_missing');
    let games=base.value.games;
    const captures=[];
    for (const eventId of plan.events) {
      if (games.some(g=>g.season===plan.season && g.eventId===eventId)) continue;
      const startedAt=new Date().toISOString();
      const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${eventId}`,
        {signal:AbortSignal.timeout(15000),redirect:'error'});
      if (!response.ok) throw Error('recovery_provider_http_failure');
      const raw=await response.text(), receivedAt=new Date().toISOString();
      if (Buffer.byteLength(raw)>8_000_000) throw Error('recovery_response_too_large');
      const value=recoverOvertime(raw,eventId,plan.season,startedAt,receivedAt);
      games=mergeGames(games,value.games);
      captures.push({key:`research:ncaaf:game-summary:${plan.season}:${eventId}:recovered:${receivedAt}`,value});
    }
    if (!captures.length) {console.log(JSON.stringify({alreadyPresent:true,requests:0,automaticUnlock:false}));return;}
    await db.query('BEGIN');transaction=true;
    for (const row of captures) await db.query('INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',
      [row.key,JSON.stringify(row.value)]);
    const key=`research:ncaaf:history-summary:${plan.season}:${new Date().toISOString()}`;
    await db.query('INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [key,JSON.stringify({
      ...base.value,games,baseSummaryKey:base.key,sourceKeys:[...(base.value.sourceKeys??[]),...captures.map(c=>c.key)],
      coverage:'explicit_overtime_recovery_unverified',researchOnly:true,automaticUnlock:false,
      historicalAvailabilityVerified:false,rulesetCompatibilityVerified:false
    })]);
    await db.query('COMMIT');transaction=false;
    console.log(JSON.stringify({saved:true,recovered:captures.length,uniqueGames:games.length,
      overtimeGames:games.filter(g=>g.overtime===true).length,automaticUnlock:false}));
  } catch(error) {
    if(transaction) await db.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {
    if(locked) await db.query('SELECT pg_advisory_unlock(64233,20261027)').catch(()=>{});
    await db.end();
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(/^recovery_[a-z_]+$/.test(error?.message)?error.message:'recovery_failed');process.exitCode=1;});

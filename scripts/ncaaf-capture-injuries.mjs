/** Forward-only research evidence. Absent teams are UNKNOWN, never healthy. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildInjuryArchive(raw, requestStartedAt, receivedAt) {
  const start = Date.parse(requestStartedAt), end = Date.parse(receivedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw Error('invalid_capture_times');
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.injuries)) throw Error('invalid_injury_payload');
  const teams = new Set();
  for (const team of payload.injuries) {
    if (typeof team.displayName !== 'string' || !team.displayName.trim() ||
        teams.has(team.displayName) || !Array.isArray(team.injuries))
      throw Error('invalid_team_identity');
    teams.add(team.displayName);
  }
  return { version: 1, researchOnly: true, source: 'espn_ncaaf_injuries',
    requestStartedAt, receivedAt, observedAt: receivedAt,
    teamCount: teams.size, coverage: 'reported_teams_only',
    absentTeamStatus: 'unknown', historicalBackfillAllowed: false,
    sha256: createHash('sha256').update(raw).digest('hex'), rawResponse: raw };
}

export function usableBeforeKickoff(archive, kickoff) {
  const observed = Date.parse(archive.observedAt), game = Date.parse(kickoff);
  return Number.isFinite(observed) && Number.isFinite(game) && observed < game;
}

async function main() {
  if (!process.argv.includes('--execute')) {
    console.log('Plan only: capture current ESPN injuries into research app_kv; no historical backfill or unlock. Add --execute.');
    return;
  }
  if (!process.env.DATABASE_URL) throw Error('database_environment_missing');
  const requireDb = createRequire(resolve(process.env.NCAAF_REPO_ROOT ?? '/opt/render/project/src', 'lib/db/package.json'));
  const { Client } = requireDb('pg');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const check = await db.query('SELECT current_database() AS name');
    if (check.rows[0].name !== 'stadium_edge_production') throw Error('unexpected_database');
    const lock = await db.query('SELECT pg_try_advisory_lock(64233, 20261024) AS acquired');
    if (!lock.rows[0].acquired) throw Error('collector_already_running');
    const bucket = new Date().toISOString().slice(0,16);
    const key = `research:ncaaf:injuries:${bucket}`;
    const prior = await db.query('SELECT key FROM public.app_kv WHERE key=$1', [key]);
    if (prior.rowCount) { console.log('Snapshot already captured this minute.'); return; }
    const requestStartedAt = new Date().toISOString();
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/injuries', {signal: AbortSignal.timeout(15000), redirect:'error'});
    if (!response.ok) throw Error(`provider_http_${response.status}`);
    const raw = await response.text();
    const receivedAt = new Date().toISOString();
    if (Buffer.byteLength(raw)>5_000_000) throw Error('response_too_large');
    const archive = buildInjuryArchive(raw, requestStartedAt, receivedAt);
    await db.query('INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [key,JSON.stringify(archive)]);
    console.log(JSON.stringify({saved:true,observedAt:archive.observedAt,teamCount:archive.teamCount,absentTeamStatus:'unknown',automaticUnlock:false}));
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {console.error('Injury capture failed; no healthy status inferred and no unlock performed.');process.exitCode=1;});

/** Offline research importer. Never called by Coach or authorized to unlock it. */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function collectionDates() {
  const dates = [];
  for (const start of ['2023-09-02', '2024-08-31']) {
    const day = new Date(start + 'T16:00:00Z');
    for (let week = 0; week < 14; week++) {
      dates.push(day.toISOString().replace('.000Z', 'Z'));
      day.setUTCDate(day.getUTCDate() + 7);
    }
  }
  return dates;
}

export function archiveSnapshot(raw, requestedAt, retrievedAt) {
  const p = JSON.parse(raw), stamp = Date.parse(p.timestamp);
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(requested) || !Number.isFinite(stamp) || stamp > requested ||
      requested - stamp > 30 * 60000 || !Array.isArray(p.data) || !p.data.length)
    throw Error('invalid_snapshot');
  const ids = new Set();
  for (const g of p.data) {
    if (typeof g.id !== 'string' || !g.id || ids.has(g.id) ||
        g.sport_key !== 'americanfootball_ncaaf' ||
        typeof g.home_team !== 'string' || !g.home_team.trim() ||
        typeof g.away_team !== 'string' || !g.away_team.trim() ||
        g.home_team === g.away_team || !Number.isFinite(Date.parse(g.commence_time)))
      throw Error('invalid_event_identity');
    ids.add(g.id);
  }
  return { researchOnly: true, requestedAt, retrievedAt,
    source: 'the-odds-api',
    sha256: createHash('sha256').update(raw).digest('hex'), rawResponse: raw };
}

async function main() {
  const dates = collectionDates();
  console.log(JSON.stringify({ snapshots: dates.length, maximumRequests: 28,
    estimatedMaximumCredits: 840, automaticUnlock: false }));
  if (!process.argv.includes('--execute')) {
    console.log('Plan only. Add --execute to collect into research keys.');
    return;
  }
  if (!process.env.ODDS_API_KEY || !process.env.DATABASE_URL)
    throw Error('required_environment_missing');
  const requireDb = createRequire(resolve(process.env.NCAAF_REPO_ROOT ?? '/opt/render/project/src', 'lib/db/package.json'));
  const { Client } = requireDb('pg');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const result = await db.query('SELECT current_database() AS name');
    if (result.rows[0].name !== 'stadium_edge_production') throw Error('unexpected_database');
    // One collector at a time; don't duplicate charged requests across shells.
    const lock = await db.query('SELECT pg_try_advisory_lock(64233, 20261023) AS acquired');
    if (!lock.rows[0].acquired) throw Error('collector_already_running');
    let requests = 0, credits = 0;
    for (const date of dates) {
      const key = `research:ncaaf:odds:${date}:us:three-markets`;
      const existing = await db.query('SELECT key FROM public.app_kv WHERE key=$1', [key]);
      if (existing.rowCount) { console.log(date, 'cached'); continue; }
      if (++requests > 28 || credits + 30 > 840) throw Error('request_budget_exceeded');
      const url = new URL('https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds');
      url.search = new URLSearchParams({ apiKey: process.env.ODDS_API_KEY,
        regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', date });
      const r = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!r.ok) throw Error(`provider_http_${r.status}`);
      const cost = Number(r.headers.get('x-requests-last'));
      credits += Number.isFinite(cost) && cost > 0 ? cost : 30;
      const raw = await r.text();
      if (Buffer.byteLength(raw) > 5_000_000) throw Error('snapshot_too_large');
      const archive = archiveSnapshot(raw, date, new Date().toISOString());
      await db.query('INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [key, JSON.stringify(archive)]);
      console.log(date, 'saved', JSON.parse(raw).data.length, 'game rows');
    }
    console.log(JSON.stringify({ complete: true, requests, credits, automaticUnlock: false }));
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => { console.error('Collection stopped; saved dates are retained. No unlock performed.'); process.exitCode = 1; });

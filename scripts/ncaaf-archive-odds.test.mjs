import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveSnapshot, collectionDates } from './ncaaf-archive-odds.mjs';
const date = '2023-10-07T16:00:00Z';
const game = { id: 'event-1', sport_key: 'americanfootball_ncaaf', home_team: 'Home', away_team: 'Away', commence_time: '2023-10-07T19:00:00Z', bookmakers: [] };
const payload = { timestamp: '2023-10-07T15:55:00Z', data: [game] };
test('bounded schedule contains 28 unique snapshots, including existing dates', () => {
  const d = collectionDates(); assert.equal(d.length, 28); assert.equal(new Set(d).size, 28);
  assert.ok(d.includes(date)); assert.ok(d.includes('2024-10-19T16:00:00Z'));
});
test('preserves source bytes and distinguishes retrieval from historical observation', () => {
  const raw = JSON.stringify(payload), a = archiveSnapshot(raw, date, '2026-10-23T00:00:00Z');
  assert.equal(a.rawResponse, raw); assert.equal(a.researchOnly, true);
  assert.equal(JSON.parse(a.rawResponse).timestamp, payload.timestamp); assert.equal(a.sha256.length, 64);
});
test('rejects future/stale observations, duplicates and cross-sport identities', () => {
  for (const p of [{...payload,timestamp:'2023-10-07T16:05:00Z'}, {...payload,timestamp:'2023-10-07T15:00:00Z'}, {...payload,data:[game,game]}, {...payload,data:[{...game,sport_key:'americanfootball_nfl'}]}, {...payload,data:[{...game,away_team:'Home'}]}])
    assert.throws(() => archiveSnapshot(JSON.stringify(p), date, '2026-10-23T00:00:00Z'));
});

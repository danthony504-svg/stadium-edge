import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoachCandidateChunk } from './coachCandidateTracking.ts';
const body = () => ({ version: 1, requestId: 'candidate-audit-123', requested: 7, returned: 3, terminal: 'completed', omittedObservations: 0, chunkIndex: 0, totalChunks: 1, coverage: 'observed_pipeline_candidates', rows: [{candidateId: 1, kind: 'prop', sport: 'nba', eventId: '123', athleteId: '456', market: 'player_points', selection: '', game: 'A_B', sportsbook: 'book', side: 'Over', line: 15.5, odds: -110, disposition: 'excluded', omittedTransitions: 0, observations: [{ stage: 'delivery_blocked', reason: 'ticket_constraint:correlation' }] }] });
test('accepts bounded candidate gate evidence and strips extra payload fields', () => {
 const b = body(); b.rows[0].secret = 'not retained';
 const out = parseCoachCandidateChunk(b);
 assert.equal(out.rows[0].observations[0].reason, 'ticket_constraint:correlation');
 assert.equal(out.evidenceSource, 'client_reported');
 assert.ok(!JSON.stringify(out).includes('not retained'));
});
test('rejects oversized, invalid, duplicate or unsafe diagnostics', () => {
 for (const change of [b => b.requestId = 'Bearer secret', b => b.totalChunks = 0, b => b.chunkIndex = 40, b => b.rows[0].observations[0].reason = 'raw error with secrets', b => b.rows.push(b.rows[0]), b => b.rows[0].odds = Infinity, b => b.rows = Array(101).fill(b.rows[0])]) {
  const b = body(); change(b); assert.equal(parseCoachCandidateChunk(b), null);
 }
});
test('accepts an actual client report through the backend projection', async () => {
 const { createCandidateTracking } = await import('../../../stadium-mobile/lib/coachCandidateTracking.ts');
 const tracking = createCandidateTracking('request-123', 7);
 tracking.observe({ isProp: false, sport: 'nfl', game: 'Away @ Home', market: 'Spread', pick: 'Away +4.5', odds: -110 }, 'delivery_blocked', 'ticket_constraint:per_game_cap');
 const report = tracking.finish([], 'completed');
 const chunk = parseCoachCandidateChunk({ ...report, chunkIndex: 0, totalChunks: 1 });
 assert.equal(chunk.rows[0].kind, 'game_line');
 assert.equal(chunk.rows[0].observations[0].reason, 'ticket_constraint:per_game_cap');
});

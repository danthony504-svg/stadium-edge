import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateTracking } from './coachCandidateTracking.ts';
const pick = (patch = {}) => ({ isProp: true, eventId: 'event1', athleteId: 'athlete1', market: 'Points', player: 'Private Name', game: 'A @ B', odds: -110, propSide: 'Over', propLine: 15.5, ...patch }) as any;
test('records actual gate transitions and distinguishes unevaluated candidates', () => {
  const t = createCandidateTracking('request', 7);
  const selected = pick(), blocked = pick({ athleteId: 'athlete2' }), pending = pick({ athleteId: 'athlete3' });
  t.observe(selected, 'simulation', 'simulation_completed');
  t.observe(blocked, 'grading', 'graded');
  t.observe(blocked, 'delivery_blocked', 'ticket_constraint:correlation');
  t.observe(pending, 'posted', 'posted');
  const report = t.finish([selected], 'timed_out');
  assert.equal(report.rows[0].disposition, 'selected');
  assert.equal(report.rows[1].disposition, 'excluded');
  assert.equal(report.rows[1].observations.at(-1)?.reason, 'ticket_constraint:correlation');
  assert.equal(report.rows[2].disposition, 'not_evaluated');
  assert.equal(report.returned, 1);
  assert.ok(!JSON.stringify(report).includes('Private Name'));
  t.observe(pick({ athleteId: 'late' }), 'posted', 'posted');
  assert.equal(report.rows.length, 3);
});
test('caps rows, bounds transitions, distinguishes exact quotes', () => {
  const t = createCandidateTracking('request', 7, 2);
  t.observe(pick(), 'posted', 'posted');
  t.observe(pick({ odds: -120 }), 'posted', 'posted');
  for (let i = 0; i < 20; i++) t.observe(pick(), 'simulation', `attempt_${i}`);
  t.observe(pick({ athleteId: 'overflow' }), 'posted', 'posted');
  const report = t.finish([], 'error');
  assert.equal(report.rows.length, 2);
  assert.equal(report.omittedObservations, 1);
  assert.equal(report.rows[0].observations.length, 8);
  assert.equal(report.rows[0].observations.at(-1)?.reason, 'attempt_19');
});
test('game lines are tracked independently of props', () => {
  const t = createCandidateTracking('request', 7);
  const p = pick({ isProp: false, athleteId: undefined, player: undefined, market: 'Spread' });
  t.observe(p, 'simulation', 'simulation_unavailable');
  const report = t.finish([], 'completed');
  assert.equal(report.rows[0].kind, 'game_line');
  assert.equal(report.rows[0].observations[0].reason, 'simulation_unavailable');
});
test('final selections survive audit cap and preserve a unique identity', () => {
  const t = createCandidateTracking('request', 7, 2);
  t.observe(pick(), 'posted', 'posted');
  t.observe(pick({ athleteId: 'second' }), 'posted', 'posted');
  const final = pick({ athleteId: 'final' });
  const report = t.finish([final], 'completed');
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows.find(r => r.athleteId === 'final')?.disposition, 'selected');
  assert.equal(new Set(report.rows.map(r => r.candidateId)).size, 2);
  assert.equal(report.omittedObservations, 1);
});

test('missing simulations remain incomplete after the scanner grading observation', () => {
 const t = createCandidateTracking('request', 7);
 const p = pick({isProp: false, market: 'Spread'});
 t.observe(p, 'simulation', 'simulation_unavailable');
 t.observe(p, 'grading', 'simulation_or_grade_unavailable');
 const report = t.finish([], 'completed');
 assert.equal(report.rows[0].disposition, 'evaluation_incomplete');
 assert.equal(report.rows[0].observations.length, 2);
});
test('a real quality rejection remains excluded after an incomplete attempt', () => {
 const t = createCandidateTracking('request', 7);
 const p = pick();
 t.observe(p, 'simulation', 'simulation_unavailable');
 t.observe(p, 'grading', 'quality_grade_floor');
 assert.equal(t.finish([], 'completed').rows[0].disposition, 'excluded');
});

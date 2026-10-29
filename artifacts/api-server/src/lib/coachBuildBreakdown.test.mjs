import test from 'node:test';
import assert from 'node:assert/strict';
import { coachBuildBreakdown } from './coachBuildBreakdown.ts';
test('short tickets expose counters without inventing rejection reasons', () => {
  const result = coachBuildBreakdown({ requestedLegCount: 7, returnedLegCount: 3, deepSimRequested: 20, deepSimCompleted: 12 });
  assert.equal(result.shortfall, 4);
  assert.equal(result.simulationsCompleted, 12);
  assert.equal(result.qualified, null);
  assert.equal(result.rejectionAttribution, 'unavailable_without_per_candidate_gate_events');
});
test('missing, negative and nonfinite counters remain unknown', () => {
  const result = coachBuildBreakdown({ requestedLegCount: NaN, returnedLegCount: -1, totalMs: Infinity, candidatesSelected: 1.5 });
  assert.equal(result.shortfall, null);
  assert.equal(result.totalMs, null);
  assert.equal(result.selectedForEvaluation, null);
});

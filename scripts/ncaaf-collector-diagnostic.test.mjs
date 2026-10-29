import test from 'node:test';
import assert from 'node:assert/strict';
import { collectorFailureDiagnostic } from './ncaaf-collector-diagnostic.mjs';
test('diagnostics retain known timeout and phase without exception text', () => {
  const d = collectorFailureDiagnostic(Object.assign(new Error('sensitive arbitrary payload'), { code: '57014' }), 'archive_lookup');
  assert.equal(d.failureCode, 'collector_database_timeout');
  assert.equal(d.failurePhase, 'archive_lookup');
  assert.equal(d.releaseEligible, false);
  assert.doesNotMatch(JSON.stringify(d), /sensitive/);
  assert.equal(collectorFailureDiagnostic(new Error('Query read timeout'), 'history_lookup').failureCode, 'collector_database_timeout');
});
test('unknown exceptions and phases fail closed to allowlisted labels', () => {
  const d = collectorFailureDiagnostic(new Error('secret'), 'raw SQL or athlete');
  assert.equal(d.failureCode, 'collector_internal_failure');
  assert.equal(d.failurePhase, 'unknown');
  assert.equal(collectorFailureDiagnostic(new Error('usage_history_missing'), 'history_lookup').failureCode, 'usage_history_missing');
});

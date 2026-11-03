/** Never persist exception text: it can contain SQL, secrets or athlete records. */
export function collectorFailureDiagnostic(error, phase) {
  const codes = new Set([
    'usage_history_missing', 'usage_invalid_plan', 'usage_overlap',
    'context_overlap', 'context_target_budget',
    'usage_unexpected_database', 'context_unexpected_database',
  ]);
  const phases = new Set([
    'database_check', 'archive_lookup', 'event_binding', 'history_lookup',
    'usage_plan', 'usage_capture', 'usage_save', 'context_assembly', 'labels',
    'status_save',
  ]);
  const failureCode = codes.has(error?.message) ? error.message
    : error?.code === '57014' || error?.message === 'Query read timeout'
      ? 'collector_database_timeout'
      : error?.code === '53200' ? 'collector_database_resource_exhausted'
      : 'collector_internal_failure';
  return { state: 'failed', failureCode,
    failurePhase: phases.has(phase) ? phase : 'unknown',
    researchOnly: true, releaseEligible: false,
    finishedAt: new Date().toISOString() };
}

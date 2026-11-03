/** Observe-only summary. Missing telemetry is unknown, never a rejection. */
export function coachBuildBreakdown(input: Record<string, unknown>) {
  const count = (key: string) => {
    const value = input[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const requested = count('requestedLegCount');
  const returned = count('returnedLegCount');
  return {
    version: 1,
    requested,
    returned,
    shortfall: requested !== null && returned !== null ? Math.max(0, requested - returned) : null,
    poolBefore: count('candidatesPoolBefore'),
    poolAfter: count('candidatesPoolAfter'),
    selectedForEvaluation: count('candidatesSelected'),
    simulationsRequested: count('deepSimRequested'),
    simulationsCompleted: count('deepSimCompleted'),
    qualified: count('qualifiedCount'),
    // These counters can overlap and are not sufficient to attribute rejections.
    rejectionAttribution: 'unavailable_without_per_candidate_gate_events',
    terminalStatus: typeof input.terminalStatus === 'string' ? input.terminalStatus : null,
    totalMs: count('totalMs'),
    timings: Object.fromEntries(['loadMs', 'enrichmentMs', 'propSimMs', 'gameSimMs', 'qualificationMs', 'finalizationMs'].map(key => [key, count(key)])),
    evidenceSource: 'client_reported',
  };
}

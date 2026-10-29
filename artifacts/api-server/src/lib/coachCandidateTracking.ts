const stages = new Set(['posted', 'eligible', 'scope_excluded', 'simulation', 'grading', 'delivery_blocked', 'selected', 'not_evaluated']);
const dispositions = new Set(['selected', 'excluded', 'evaluated_not_selected', 'evaluation_incomplete', 'not_evaluated']);
const terminals = new Set(['completed', 'timed_out', 'cancelled', 'error']);
const integer = (v: unknown, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const code = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && /^[a-zA-Z0-9_.:-]*$/.test(v);
/** Strict projection: no names, user asks, arbitrary errors, or provider payloads. */
export function parseCoachCandidateChunk(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, any>;
  if (b.version !== 1 || !code(b.requestId, 100) || !b.requestId || !terminals.has(b.terminal)
    || !integer(b.requested, 15) || !integer(b.returned, 15) || !integer(b.omittedObservations, 1_000_000)
    || !integer(b.totalChunks, 40) || b.totalChunks < 1 || !integer(b.chunkIndex, 39) || b.chunkIndex >= b.totalChunks
    || b.coverage !== 'observed_pipeline_candidates' || !Array.isArray(b.rows) || b.rows.length > 100) return null;
  const seen = new Set<number>();
  const rows = [];
  for (const r of b.rows) {
    if (!r || !integer(r.candidateId, 1000) || r.candidateId < 1 || seen.has(r.candidateId)
      || (r.kind !== 'prop' && r.kind !== 'game_line') || !dispositions.has(r.disposition)
      || !['sport', 'eventId', 'athleteId', 'market', 'side', 'selection', 'game', 'sportsbook'].every(k => code(r[k], 96))
      || !(r.line === null || (typeof r.line === 'number' && Number.isFinite(r.line)))
      || !(r.odds === null || (typeof r.odds === 'number' && Number.isFinite(r.odds)))
      || !integer(r.omittedTransitions, 1_000_000) || !Array.isArray(r.observations) || r.observations.length < 1 || r.observations.length > 8) return null;
    const observations = [];
    for (const o of r.observations) {
      if (!o || !stages.has(o.stage) || !code(o.reason, 240)) return null;
      observations.push({ stage: o.stage as string, reason: o.reason as string });
    }
    seen.add(r.candidateId);
    rows.push({ candidateId: r.candidateId as number, kind: r.kind as string, sport: r.sport as string,
      eventId: r.eventId as string, athleteId: r.athleteId as string, market: r.market as string,
      selection: r.selection as string, game: r.game as string, sportsbook: r.sportsbook as string, side: r.side as string, line: r.line as number | null, odds: r.odds as number | null,
      disposition: r.disposition as string, omittedTransitions: r.omittedTransitions as number, observations });
  }
  return { version: 1, requestId: b.requestId as string, terminal: b.terminal as string, requested: b.requested as number,
    returned: b.returned as number, omittedObservations: b.omittedObservations as number, chunkIndex: b.chunkIndex as number,
    totalChunks: b.totalChunks as number, coverage: 'observed_pipeline_candidates', evidenceSource: 'client_reported', rows };
}

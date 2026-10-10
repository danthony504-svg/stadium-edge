/**
 * Read-only policy for GET /api/coach/slate.
 *
 * Expensive slate generation (odds fan-out, board scan, deep sim) must only run
 * from the authenticated cron / worker path. Public GETs only read the
 * persisted coach_precomputed_slate row and return a stable degraded response
 * when the snapshot is missing or stale — they must never start runCoachSlateJob.
 */

export type CoachSlateRowFlags = {
  snapshot: unknown | null;
  fresh: boolean;
  instantServe: boolean;
};

/** True when a client-usable snapshot can be served (fresh or instant-serve). */
export function hasUsableCoachSlateSnapshot(row: CoachSlateRowFlags): boolean {
  return !!(row.snapshot && (row.fresh || row.instantServe));
}

/**
 * True when the persisted slate is missing or past fresh TTL.
 * Used only as a UI/ops signal (`refreshing`) — does NOT authorize job start.
 */
export function coachSlateNeedsRefresh(row: CoachSlateRowFlags): boolean {
  return !row.fresh && (!row.snapshot || row.instantServe);
}

/**
 * GET handlers must never start slate generation.
 * Generation is reserved for POST /api/coach/slate/cron (x-cron-key).
 */
export function coachSlateGetMayStartJob(_row: CoachSlateRowFlags): false {
  return false;
}

/** Concurrent GETs: policy is read-only, so they cannot launch duplicate jobs. */
export function concurrentCoachSlateGetsMayStartJobs(
  requestCount: number,
): boolean {
  if (requestCount < 1) return false;
  // Even N parallel GETs must not start generation.
  return false;
}

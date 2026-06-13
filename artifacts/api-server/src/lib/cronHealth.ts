// Pure cron-heartbeat health logic, factored out of notifyJobs.ts so the
// stall-detection decision can be unit-tested without a database (notifyJobs.ts
// pulls in @workspace/db plus the whole push/coach/steals import graph). The
// db-coupled getCronHealth in notifyJobs.ts reads the heartbeat from KV and then
// defers entirely to deriveCronHealth here — so a test of this function is a test
// of exactly the logic that decides whether we believe the background job is
// alive. Keeping this side-effect-free and import-free is deliberate.

// A run is MISSING if none was recorded within this window. The schedule fires
// ~every 15 min, so 35 min tolerates one fully-missed tick before flagging it.
export const CRON_STALE_AFTER_MS = 35 * 60 * 1000;

export type CronHeartbeat = { at: number; summary: Record<string, number> };

export type CronHealth = {
  // ISO timestamp of the last recorded run, or null if one has never run.
  lastRunAt: string | null;
  ageMs: number | null;
  ageMinutes: number | null;
  // true when no run was recorded inside CRON_STALE_AFTER_MS (incl. never-run).
  stale: boolean;
  // true only once a run has actually been recorded (distinguishes "stalled"
  // from "brand-new deploy that hasn't had its first tick yet").
  everRan: boolean;
  // The summary from the last run, so coachSwept et al. are observable.
  summary: Record<string, number> | null;
};

// Derive whether the schedule looks healthy from the (optional) last heartbeat
// and the current time. A missing or malformed heartbeat is treated as
// never-run: stale=true, everRan=false. Otherwise stale once the run is older
// than CRON_STALE_AFTER_MS.
export function deriveCronHealth(
  hb: CronHeartbeat | undefined | null,
  now: number,
): CronHealth {
  if (!hb || typeof hb.at !== "number") {
    return {
      lastRunAt: null,
      ageMs: null,
      ageMinutes: null,
      stale: true,
      everRan: false,
      summary: null,
    };
  }
  const ageMs = now - hb.at;
  return {
    lastRunAt: new Date(hb.at).toISOString(),
    ageMs,
    ageMinutes: Math.round(ageMs / 60000),
    stale: ageMs > CRON_STALE_AFTER_MS,
    everRan: true,
    summary: hb.summary ?? null,
  };
}

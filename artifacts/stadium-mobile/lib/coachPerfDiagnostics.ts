/**
 * Observe-only Coach performance diagnostics for reliability/coach-events.
 *
 * Never changes selection, grading, simulation counts, floors, or provenance.
 * Timings are monotonic wall clocks for sequential phases; parallel enrichment
 * is one wall (enrichmentMs), never a sum of overlapping work.
 */

import { tryGetExpoUpdates } from "./expoUpdatesAccess.ts";

export type CoachTerminalStatus =
  | "fulfilled"
  | "shortfall"
  | "empty"
  | "timed_out"
  | "cancelled"
  | "error"
  | "grounding_failure";

/** Compact counters + sub-phase timings attached to a Coach request. */
export type CoachPerfCounters = {
  propSimMs: number | null;
  gameSimMs: number | null;
  qualificationMs: number | null;
  candidatesPoolBefore: number | null;
  candidatesPoolAfter: number | null;
  candidatesSelected: number | null;
  deepSimRequested: number | null;
  deepSimCompleted: number | null;
  qualifiedCount: number | null;
  requestedSport: string | null;
  effectiveSports: string[] | null;
};

export function createCoachPerfCounters(
  seed?: Partial<CoachPerfCounters>,
): CoachPerfCounters {
  return {
    propSimMs: seed?.propSimMs ?? null,
    gameSimMs: seed?.gameSimMs ?? null,
    qualificationMs: seed?.qualificationMs ?? null,
    candidatesPoolBefore: seed?.candidatesPoolBefore ?? null,
    candidatesPoolAfter: seed?.candidatesPoolAfter ?? null,
    candidatesSelected: seed?.candidatesSelected ?? null,
    deepSimRequested: seed?.deepSimRequested ?? null,
    deepSimCompleted: seed?.deepSimCompleted ?? null,
    qualifiedCount: seed?.qualifiedCount ?? null,
    requestedSport: seed?.requestedSport ?? null,
    effectiveSports: seed?.effectiveSports ?? null,
  };
}

/** Expo Updates.updateId when available — never throws. */
export function resolveCoachClientUpdateId(): string | null {
  try {
    const Updates = tryGetExpoUpdates();
    if (!Updates) return null;
    const id = Updates.updateId;
    if (id == null) return null;
    const s = String(id).trim();
    return s ? s.slice(0, 80) : null;
  } catch {
    return null;
  }
}

export function roundPerfMs(ms: number | null | undefined): number | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms));
}

/**
 * Monotonic clock for sub-phase walls (propSim / gameSim / qualification).
 * Prefer performance.now(); fall back to Date.now() when unavailable.
 */
export function coachPerfNowMs(): number {
  try {
    if (
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
    ) {
      return performance.now();
    }
  } catch {
    /* fall through */
  }
  return Date.now();
}

export function coachPerfElapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(coachPerfNowMs() - startedAt));
}

export function normalizeEffectiveSports(
  sports: readonly string[] | null | undefined,
): string[] | null {
  if (!sports?.length) return null;
  const out = [
    ...new Set(
      sports
        .map((s) => String(s ?? "").toLowerCase().trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 24)),
    ),
  ].slice(0, 8);
  return out.length ? out : null;
}

/**
 * Derive a stable terminalStatus for diagnostics (independent of Telegram rules).
 */
export function deriveCoachTerminalStatus(opts: {
  cancelled?: boolean;
  timedOut?: boolean;
  deliveryCommitted?: boolean;
  requestedLegCount?: number | null;
  returnedLegCount?: number | null;
  eventType?: string | null;
  failureReason?: string | null;
}): CoachTerminalStatus {
  if (opts.cancelled) return "cancelled";
  if (opts.timedOut) return "timed_out";
  if (opts.eventType === "coach_grounding_failure") return "grounding_failure";
  if (
    opts.eventType === "coach_exception" ||
    opts.failureReason === "exception"
  ) {
    return "error";
  }
  const requested =
    typeof opts.requestedLegCount === "number" ? opts.requestedLegCount : null;
  const returned =
    typeof opts.returnedLegCount === "number" ? opts.returnedLegCount : null;
  if (
    opts.deliveryCommitted &&
    requested != null &&
    returned != null &&
    returned >= requested &&
    returned > 0
  ) {
    return "fulfilled";
  }
  if (returned === 0 && requested != null) return "empty";
  if (
    requested != null &&
    returned != null &&
    returned > 0 &&
    returned < requested
  ) {
    return "shortfall";
  }
  if (opts.eventType === "parlay_fulfilled") return "fulfilled";
  if (opts.eventType === "parlay_underfilled") return "shortfall";
  if (opts.eventType === "parlay_zero_results") return "empty";
  if (opts.eventType === "coach_scan_freeze") return "timed_out";
  return "error";
}

/** Fields safe to merge onto a coach-events POST body / meta JSON. */
export function coachPerfBodyFields(opts: {
  updateId?: string | null;
  enrichmentMs?: number | null;
  propSimMs?: number | null;
  gameSimMs?: number | null;
  qualificationMs?: number | null;
  loadMs?: number | null;
  scanMs?: number | null;
  finalizationMs?: number | null;
  totalMs?: number | null;
  lastCompletedPhase?: string | null;
  pendingOperation?: string | null;
  timeoutReason?: string | null;
  terminalStatus?: CoachTerminalStatus | string | null;
  requestedSport?: string | null;
  effectiveSports?: readonly string[] | null;
  candidatesPoolBefore?: number | null;
  candidatesPoolAfter?: number | null;
  candidatesSelected?: number | null;
  deepSimRequested?: number | null;
  deepSimCompleted?: number | null;
  qualifiedCount?: number | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const putMs = (key: string, v: number | null | undefined) => {
    const n = roundPerfMs(v);
    if (n != null) out[key] = n;
  };
  const putInt = (key: string, v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = Math.max(0, Math.round(v));
    }
  };
  if (opts.updateId) out.updateId = String(opts.updateId).slice(0, 80);
  putMs("enrichmentMs", opts.enrichmentMs);
  putMs("propSimMs", opts.propSimMs);
  putMs("gameSimMs", opts.gameSimMs);
  putMs("qualificationMs", opts.qualificationMs);
  putMs("loadMs", opts.loadMs);
  putMs("scanMs", opts.scanMs);
  putMs("finalizationMs", opts.finalizationMs);
  putMs("totalMs", opts.totalMs);
  if (opts.lastCompletedPhase) {
    out.lastCompletedPhase = String(opts.lastCompletedPhase).slice(0, 40);
  }
  if (opts.pendingOperation) {
    out.pendingOperation = String(opts.pendingOperation).slice(0, 40);
  }
  if (opts.timeoutReason) {
    out.timeoutReason = String(opts.timeoutReason).slice(0, 40);
  }
  if (opts.terminalStatus) {
    out.terminalStatus = String(opts.terminalStatus).slice(0, 40);
  }
  if (opts.requestedSport) {
    out.requestedSport = String(opts.requestedSport).slice(0, 24);
  }
  const sports = normalizeEffectiveSports(opts.effectiveSports);
  if (sports) out.effectiveSports = sports;
  putInt("candidatesPoolBefore", opts.candidatesPoolBefore);
  putInt("candidatesPoolAfter", opts.candidatesPoolAfter);
  putInt("candidatesSelected", opts.candidatesSelected);
  putInt("deepSimRequested", opts.deepSimRequested);
  putInt("deepSimCompleted", opts.deepSimCompleted);
  putInt("qualifiedCount", opts.qualifiedCount);
  return out;
}

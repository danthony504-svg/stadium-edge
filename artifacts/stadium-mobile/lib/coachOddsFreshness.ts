/**
 * Pregame Coach odds freshness — fail closed when snapshot proof is missing/stale.
 * Live Coach keeps its own 45s classifier; this module is for ticket delivery.
 */

export const COACH_PREGAME_ODDS_STALE_AFTER_MS = 10 * 60 * 1000;

export type CoachOddsFreshnessStatus = "fresh" | "stale" | "unknown";

export type CoachOddsSnapshot = {
  eventId?: string | null;
  sportsbook?: string | null;
  oddsFetchedAt?: string | null;
  providerLastUpdate?: string | null;
  oddsProvider?: string | null;
  odds?: number | null;
  market?: string | null;
  propLine?: number | null;
  propSide?: string | null;
  isProp?: boolean;
};

export type CoachOddsFreshnessResult = {
  status: CoachOddsFreshnessStatus;
  ageMs: number | null;
  ageSource: "providerLastUpdate" | "fetchedAt" | "none";
};

function parseTs(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

/** Classify pregame odds age. Prefer providerLastUpdate, else fetchedAt. */
export function classifyCoachOddsFreshness(opts: {
  providerLastUpdate?: string | null;
  fetchedAt?: string | null;
  nowMs?: number;
  staleAfterMs?: number;
}): CoachOddsFreshnessResult {
  const now = opts.nowMs ?? Date.now();
  const staleAfter = opts.staleAfterMs ?? COACH_PREGAME_ODDS_STALE_AFTER_MS;

  const providerMs = parseTs(opts.providerLastUpdate);
  if (providerMs != null) {
    const ageMs = Math.max(0, now - providerMs);
    return {
      status: ageMs > staleAfter ? "stale" : "fresh",
      ageMs,
      ageSource: "providerLastUpdate",
    };
  }

  const fetchedMs = parseTs(opts.fetchedAt);
  if (fetchedMs != null) {
    const ageMs = Math.max(0, now - fetchedMs);
    return {
      status: ageMs > staleAfter ? "stale" : "fresh",
      ageMs,
      ageSource: "fetchedAt",
    };
  }

  return { status: "unknown", ageMs: null, ageSource: "none" };
}

/**
 * True when a ticket leg carries enough provenance and is within TTL.
 * Missing eventId, sportsbook, price, or freshness → not deliverable.
 */
export function legOddsSnapshotIsDeliverable(
  snap: CoachOddsSnapshot,
  opts?: { nowMs?: number; staleAfterMs?: number },
): { ok: boolean; reason: string | null; freshness: CoachOddsFreshnessResult } {
  const freshness = classifyCoachOddsFreshness({
    providerLastUpdate: snap.providerLastUpdate,
    fetchedAt: snap.oddsFetchedAt,
    nowMs: opts?.nowMs,
    staleAfterMs: opts?.staleAfterMs,
  });

  if (snap.odds == null || !Number.isFinite(snap.odds) || snap.odds === 0) {
    return { ok: false, reason: "missing_odds", freshness };
  }
  if (!String(snap.eventId ?? "").trim()) {
    return { ok: false, reason: "missing_event_id", freshness };
  }
  if (!String(snap.sportsbook ?? "").trim()) {
    return { ok: false, reason: "missing_sportsbook", freshness };
  }
  if (freshness.status === "unknown") {
    return { ok: false, reason: "unknown_freshness", freshness };
  }
  if (freshness.status === "stale") {
    return { ok: false, reason: "stale_odds", freshness };
  }
  if (snap.isProp) {
    if (snap.propLine == null || !Number.isFinite(snap.propLine) || !snap.propSide) {
      return { ok: false, reason: "missing_prop_line", freshness };
    }
  }
  return { ok: true, reason: null, freshness };
}

/** Human-readable delivery note for dropped stale/unverifiable legs. */
export function coachOddsIntegrityNote(dropped: {
  stale: number;
  unverifiable: number;
  providerOutage: number;
}): string {
  const parts: string[] = [];
  if (dropped.providerOutage > 0) {
    const n = dropped.providerOutage;
    parts.push(
      `Dropped ${n} ${n === 1 ? "pick" : "picks"} because provider props were unavailable (no replacement odds invented).`,
    );
  }
  if (dropped.stale > 0) {
    const n = dropped.stale;
    parts.push(
      `Dropped ${n} ${n === 1 ? "pick" : "picks"} with expired odds that could not be revalidated.`,
    );
  }
  if (dropped.unverifiable > 0) {
    const n = dropped.unverifiable;
    parts.push(
      `Dropped ${n} ${n === 1 ? "pick" : "picks"} missing odds provenance (event, sportsbook, or fetch time).`,
    );
  }
  return parts.join("\n\n");
}

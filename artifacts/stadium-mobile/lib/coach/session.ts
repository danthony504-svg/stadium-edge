/**
 * Greenfield Coach session — one send, one clock, one terminal latch.
 *
 * Hard rule: after latch, busy is always false. Late upgrades may change
 * cards; they cannot re-busy the composer or reopen "still scanning" limbo.
 */

export type CoachSessionOutcome =
  | "open"
  | "shown"
  | "shortfall"
  | "empty"
  | "failed";

export type CoachSession = {
  sendGen: number;
  requestedLegs: number;
  startedAtMs: number;
  outcome: CoachSessionOutcome;
  absoluteTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Total request budget from Coach send (load + enrichment + scan + finalize).
 * Deep tickets (8+) get more wall time. Load time counts against this window —
 * do not reset the clock after prop prefetch (that caused ~180s freezes).
 */
/**
 * Wall reserved inside the absolute budget for staging / correlation /
 * final ticket assembly after prop+game sim phases. Does not lower sim counts
 * or skip grading — only constrains when new simulate work may start.
 */
export const COACH_FINALIZATION_RESERVE_MS = 4_000;

export function coachFinalizationReserveMs(): number {
  return COACH_FINALIZATION_RESERVE_MS;
}

export function coachAbsoluteBudgetMs(requestedLegs: number): number {
  // Sized for football mix skill wave (≤72) overlapping game lines, plus
  // finalization reserve inside the same absolute window.
  if (requestedLegs >= 15) return 130_000;
  if (requestedLegs >= 10) return 120_000;
  if (requestedLegs >= 8) return 110_000;
  if (requestedLegs >= 6) return 90_000;
  if (requestedLegs >= 3) return 75_000;
  return 45_000;
}

/** Absolute budget minus finalization reserve — last moment to start new sim work. */
export function coachScoringWorkBudgetMs(requestedLegs: number): number {
  return Math.max(0, coachAbsoluteBudgetMs(requestedLegs) - coachFinalizationReserveMs());
}

/**
 * Load-phase failsafe — same as the total request budget. Prefetch may not
 * extend past the monotonic deadline (legacy absolute+15s caused ~180s freezes
 * when combined with a post-load clock reset).
 */
export function coachPropLoadFailsafeMs(requestedLegs = 6): number {
  return coachAbsoluteBudgetMs(requestedLegs);
}

/**
 * @deprecated PR-B: do not reset the Coach wall after prop prefetch.
 * Kept for non-parlay callers / tests. Parlay uses a single monotonic deadline
 * from beginCoachSession.
 */
export function resetCoachAbsoluteClock(session: CoachSession, now = Date.now()): void {
  if (session.absoluteTimer) {
    clearTimeout(session.absoluteTimer);
    session.absoluteTimer = null;
  }
  if (session.outcome !== "open") return;
  session.startedAtMs = now;
}

export function createCoachSession(
  sendGen = 0,
  requestedLegs = 0,
  now = Date.now(),
): CoachSession {
  return {
    sendGen,
    requestedLegs: Math.max(0, requestedLegs),
    startedAtMs: now,
    outcome: "open",
    absoluteTimer: null,
  };
}

export function beginCoachSession(
  session: CoachSession,
  opts: { sendGen: number; requestedLegs: number; now?: number },
): void {
  if (session.absoluteTimer) {
    clearTimeout(session.absoluteTimer);
    session.absoluteTimer = null;
  }
  session.sendGen = opts.sendGen;
  session.requestedLegs = Math.max(0, opts.requestedLegs);
  session.startedAtMs = opts.now ?? Date.now();
  session.outcome = "open";
}

export function coachSessionIsTerminal(session: CoachSession): boolean {
  return session.outcome !== "open";
}

export function latchCoachSession(
  session: CoachSession,
  outcome: Exclude<CoachSessionOutcome, "open">,
): void {
  if (session.absoluteTimer) {
    clearTimeout(session.absoluteTimer);
    session.absoluteTimer = null;
  }
  if (session.outcome === "open") {
    session.outcome = outcome;
  }
}

const OUTCOME_RANK: Record<Exclude<CoachSessionOutcome, "open">, number> = {
  failed: 0,
  empty: 1,
  shortfall: 2,
  shown: 3,
};

/**
 * Absolute budget may latch empty/shortfall while the scan promise is still
 * finishing. Accept a *better* late ticket for the same send without re-opening
 * the session or re-busying the composer (limbo-safe upgrade only).
 */
export function coachSessionMayAcceptLatePicks(
  session: CoachSession,
  opts: { latePickCount: number; shownPickCount: number },
): boolean {
  if (session.outcome === "open" || session.outcome === "shown") return false;
  if (opts.latePickCount <= 0) return false;
  return opts.latePickCount > opts.shownPickCount;
}

/** Promote outcome empty/failed → shortfall/shown; never reopen to "open". */
export function upgradeCoachSessionOutcome(
  session: CoachSession,
  outcome: Exclude<CoachSessionOutcome, "open">,
): void {
  if (session.absoluteTimer) {
    clearTimeout(session.absoluteTimer);
    session.absoluteTimer = null;
  }
  if (session.outcome === "open") {
    session.outcome = outcome;
    return;
  }
  if (OUTCOME_RANK[outcome] > OUTCOME_RANK[session.outcome]) {
    session.outcome = outcome;
  }
}

export function coachSessionPastBudget(
  session: CoachSession,
  now = Date.now(),
): boolean {
  return now - session.startedAtMs >= coachAbsoluteBudgetMs(session.requestedLegs || 6);
}

/** Keep composer locked only while the session is still open. */
export function coachSessionShouldKeepBusy(session: CoachSession): boolean {
  return session.outcome === "open";
}

export function armCoachAbsoluteTerminal(
  session: CoachSession,
  onFire: () => void,
): void {
  if (session.absoluteTimer || coachSessionIsTerminal(session)) return;
  const remaining = Math.max(
    0,
    session.startedAtMs + coachAbsoluteBudgetMs(session.requestedLegs || 6) - Date.now(),
  );
  session.absoluteTimer = setTimeout(() => {
    session.absoluteTimer = null;
    if (coachSessionIsTerminal(session)) return;
    onFire();
  }, remaining);
}

export function resolveCoachOutcome(opts: {
  pickCount: number;
  requestedLegs: number;
  failed?: boolean;
}): Exclude<CoachSessionOutcome, "open"> {
  if (opts.failed) return "failed";
  if (opts.pickCount <= 0) return "empty";
  if (opts.requestedLegs >= 3 && opts.pickCount < opts.requestedLegs) {
    return "shortfall";
  }
  return "shown";
}

export function coachShortfallNote(
  requestedLegs: number,
  pickCount: number,
  opts?: { propsPending?: boolean },
): string {
  if (requestedLegs < 3 || pickCount >= requestedLegs) return "";
  if (opts?.propsPending) {
    if (pickCount <= 0) {
      return `You asked for ${requestedLegs} legs — prop scoring did not finish and no AI-backed picks cleared yet. No ungraded filler was added.`;
    }
    return `You asked for ${requestedLegs} legs — only ${pickCount} cleared so far while player props were still scoring. No ungraded filler was added.`;
  }
  if (pickCount <= 0) {
    return `You asked for ${requestedLegs} legs — no AI-backed picks cleared the quality bar after the board scan.`;
  }
  // Do not claim "every posted market was scanned" — that lied when prop scoring
  // was starved and only reserved game-line slots (2 of 5 / 3 of 7) published.
  return `You asked for ${requestedLegs} legs — only ${pickCount} cleared the AI quality bar. No ungraded filler was added.`;
}

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
 * Scoring budget after the prop board is loaded. Sized so game-line sims and
 * prop/alt scoring can finish — empty propPool + short budget was locking
 * "2 game totals" as a shortfall before props ever ran.
 */
export function coachAbsoluteBudgetMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 90_000;
  if (requestedLegs >= 9) return 75_000;
  if (requestedLegs >= 6) return 70_000;
  if (requestedLegs >= 3) return 65_000;
  return 45_000;
}

/** Failsafe while prefetching the posted prop/alt board before scoring starts. */
export function coachPropLoadFailsafeMs(): number {
  return 75_000;
}

/** Restart the absolute clock (e.g. when scoring starts after prop prefetch). */
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

export function coachShortfallNote(requestedLegs: number, pickCount: number): string {
  if (requestedLegs < 3 || pickCount >= requestedLegs) return "";
  if (pickCount <= 0) {
    return `You asked for **${requestedLegs}** legs — no AI-backed picks cleared the quality bar after the board scan.`;
  }
  return `You asked for **${requestedLegs}** legs — only **${pickCount}** cleared the AI quality bar after every posted market was scanned. No ungraded filler was added.`;
}

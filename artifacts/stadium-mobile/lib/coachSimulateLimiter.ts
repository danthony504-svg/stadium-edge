/**
 * Bounded shared concurrency for Coach /sports/simulate/* calls.
 * Prop work always drains before game-line work so overlapping phases
 * cannot starve the football skill deep-sim wave.
 */

export type SimulatePriority = "prop" | "game";

export type CoachSimulateOverlapMetrics = {
  propPhaseStartMs: number | null;
  propPhaseEndMs: number | null;
  gamePhaseStartMs: number | null;
  gamePhaseEndMs: number | null;
  /** Wall ms where prop and game phases were both in flight. */
  overlapMs: number;
  simulateInFlightPeak: number;
  propQueueWaitMs: number;
  gameQueueWaitMs: number;
  totalScoringWallMs: number;
  finalizationStartMs: number | null;
  finalizationEndMs: number | null;
};

type Waiter = {
  priority: SimulatePriority;
  enqueuedAt: number;
  resolve: () => void;
};

/** Default in-flight cap for prop+game simulate HTTP (not unbounded). */
export const COACH_SIMULATE_MAX_IN_FLIGHT = 4;

export class CoachSimulateLimiter {
  private inFlight = 0;
  private peak = 0;
  private waiters: Waiter[] = [];
  private propQueueWaitMs = 0;
  private gameQueueWaitMs = 0;
  readonly maxInFlight: number;

  constructor(maxInFlight = COACH_SIMULATE_MAX_IN_FLIGHT) {
    this.maxInFlight = Math.max(1, maxInFlight);
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  get inFlightPeak(): number {
    return this.peak;
  }

  getPropQueueWaitMs(): number {
    return this.propQueueWaitMs;
  }

  getGameQueueWaitMs(): number {
    return this.gameQueueWaitMs;
  }

  async run<T>(priority: SimulatePriority, fn: () => Promise<T>): Promise<T> {
    const waitStart = Date.now();
    await this.acquire(priority);
    const waited = Date.now() - waitStart;
    if (priority === "prop") this.propQueueWaitMs += waited;
    else this.gameQueueWaitMs += waited;
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(priority: SimulatePriority): Promise<void> {
    if (this.inFlight < this.maxInFlight) {
      this.inFlight += 1;
      this.peak = Math.max(this.peak, this.inFlight);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push({ priority, enqueuedAt: Date.now(), resolve });
      this.sortWaiters();
    });
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (!this.waiters.length) return;
    this.sortWaiters();
    const next = this.waiters.shift();
    if (!next) return;
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    next.resolve();
  }

  private sortWaiters(): void {
    // Prop priority, then FIFO within the same priority.
    this.waiters.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === "prop" ? -1 : 1;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }
}

export type CoachSimulateSession = {
  limiter: CoachSimulateLimiter;
  scoringStartedAtMs: number;
  propPhaseStartMs: number | null;
  propPhaseEndMs: number | null;
  gamePhaseStartMs: number | null;
  gamePhaseEndMs: number | null;
  finalizationStartMs: number | null;
  finalizationEndMs: number | null;
  markPropPhaseStart: (now?: number) => void;
  markPropPhaseEnd: (now?: number) => void;
  markGamePhaseStart: (now?: number) => void;
  markGamePhaseEnd: (now?: number) => void;
  markFinalizationStart: (now?: number) => void;
  markFinalizationEnd: (now?: number) => void;
  snapshot: () => CoachSimulateOverlapMetrics;
};

let activeSession: CoachSimulateSession | null = null;

export function getActiveCoachSimulateSession(): CoachSimulateSession | null {
  return activeSession;
}

export function getActiveCoachSimulateLimiter(): CoachSimulateLimiter | null {
  return activeSession?.limiter ?? null;
}

export function beginCoachSimulateSession(opts?: {
  maxInFlight?: number;
  now?: number;
}): CoachSimulateSession {
  const scoringStartedAtMs = opts?.now ?? Date.now();
  const limiter = new CoachSimulateLimiter(opts?.maxInFlight);
  const session: CoachSimulateSession = {
    limiter,
    scoringStartedAtMs,
    propPhaseStartMs: null,
    propPhaseEndMs: null,
    gamePhaseStartMs: null,
    gamePhaseEndMs: null,
    finalizationStartMs: null,
    finalizationEndMs: null,
    markPropPhaseStart(now = Date.now()) {
      if (session.propPhaseStartMs == null) {
        session.propPhaseStartMs = now - scoringStartedAtMs;
      }
    },
    markPropPhaseEnd(now = Date.now()) {
      session.propPhaseEndMs = now - scoringStartedAtMs;
    },
    markGamePhaseStart(now = Date.now()) {
      if (session.gamePhaseStartMs == null) {
        session.gamePhaseStartMs = now - scoringStartedAtMs;
      }
    },
    markGamePhaseEnd(now = Date.now()) {
      session.gamePhaseEndMs = now - scoringStartedAtMs;
    },
    markFinalizationStart(now = Date.now()) {
      if (session.finalizationStartMs == null) {
        session.finalizationStartMs = now - scoringStartedAtMs;
      }
    },
    markFinalizationEnd(now = Date.now()) {
      session.finalizationEndMs = now - scoringStartedAtMs;
    },
    snapshot() {
      const propStart = session.propPhaseStartMs;
      const propEnd = session.propPhaseEndMs;
      const gameStart = session.gamePhaseStartMs;
      const gameEnd = session.gamePhaseEndMs;
      let overlapMs = 0;
      if (
        propStart != null &&
        propEnd != null &&
        gameStart != null &&
        gameEnd != null
      ) {
        const overlapStart = Math.max(propStart, gameStart);
        const overlapEnd = Math.min(propEnd, gameEnd);
        overlapMs = Math.max(0, overlapEnd - overlapStart);
      }
      const endMs =
        session.finalizationEndMs ??
        Math.max(propEnd ?? 0, gameEnd ?? 0, session.finalizationStartMs ?? 0);
      return {
        propPhaseStartMs: propStart,
        propPhaseEndMs: propEnd,
        gamePhaseStartMs: gameStart,
        gamePhaseEndMs: gameEnd,
        overlapMs,
        simulateInFlightPeak: limiter.inFlightPeak,
        propQueueWaitMs: limiter.getPropQueueWaitMs(),
        gameQueueWaitMs: limiter.getGameQueueWaitMs(),
        totalScoringWallMs: endMs,
        finalizationStartMs: session.finalizationStartMs,
        finalizationEndMs: session.finalizationEndMs,
      };
    },
  };
  activeSession = session;
  return session;
}

export function endCoachSimulateSession(): CoachSimulateOverlapMetrics | null {
  if (!activeSession) return null;
  const metrics = activeSession.snapshot();
  activeSession = null;
  return metrics;
}

/** Test helper — clear any leaked session between cases. */
export function resetCoachSimulateSessionForTests(): void {
  activeSession = null;
}

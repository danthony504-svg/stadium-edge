/** Opportunistic context preparation. Never scans, simulates, or stores tickets. */
export type CoachWarmTask = {
  key: string;
  run: () => Promise<unknown>;
  /** Discover game-specific context after the schedule arrives, within this pass. */
  followups?: () => CoachWarmTask[];
};

export function createCoachContextWarmer(now = Date.now) {
  let active = false;
  let foregroundUsers = 0;
  let running = false;
  let pending: CoachWarmTask[] = [];
  const succeededAt = new Map<string, number>();
  const stats = { started: 0, completed: 0, failed: 0, deferred: 0 };
  const maxPassMs = 8_000;
  const retryAfterMs = 60_000;

  async function drain(): Promise<void> {
    if (running || !active || foregroundUsers > 0) return;
    running = true;
    const deadline = now() + maxPassMs;
    try {
      while (active && foregroundUsers === 0 && pending.length && now() < deadline) {
        const task = pending.shift()!;
        if (now() - (succeededAt.get(task.key) ?? -Infinity) < retryAfterMs) continue;
        stats.started++;
        try {
          // At most ONE reusable context request is in flight. Do not abort a
          // shared cache producer: a foreground Coach may now be waiting on it.
          await task.run();
          succeededAt.set(task.key, now());
          stats.completed++;
          if (active && foregroundUsers === 0 && task.followups) {
            pending = [...new Map([...task.followups(), ...pending].map(t => [t.key, t])).values()];
          }
        } catch {
          stats.failed++;
        }
      }
    } finally { running = false; }
  }

  return {
    setActive(value: boolean) { active = value; if (!value) pending = []; },
    beginForeground() {
      foregroundUsers++;
      pending = []; // Requests take priority, including overlapping builds.
      let released = false;
      return () => { if (!released) { released = true; foregroundUsers--; } };
    },
    async warm(tasks: CoachWarmTask[]) {
      if (!active || foregroundUsers > 0 || running) { stats.deferred++; return; }
      pending = [...new Map([...pending, ...tasks].map(t => [t.key, t])).values()];
      await drain();
    },
    snapshot: () => ({ ...stats, running, active, foregroundUsers, queued: pending.length }),
  };
}

export const coachContextWarmer = createCoachContextWarmer();

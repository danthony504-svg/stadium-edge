/** Monte Carlo run accounting — surfaced to clients and tests. */
export type SimRunStats = {
  requestedSims: number;
  completedSims: number;
  failedSims: number;
  /** Mirrors completedSims — number of draws used in probability math. */
  actualSimCount: number;
  startedAt: string;
  finishedAt: string;
  runTimeMs: number;
  sampleGames?: number;
};

export function emptySimRunStats(requestedSims: number, sampleGames?: number): SimRunStats {
  const now = new Date().toISOString();
  return {
    requestedSims,
    completedSims: 0,
    failedSims: 0,
    actualSimCount: 0,
    startedAt: now,
    finishedAt: now,
    runTimeMs: 0,
    sampleGames,
  };
}

export function finalizeSimRunStats(
  startedAt: Date,
  requestedSims: number,
  completedSims: number,
  failedSims: number,
  sampleGames?: number,
): SimRunStats {
  const finishedAt = new Date();
  return {
    requestedSims,
    completedSims,
    failedSims,
    actualSimCount: completedSims,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    runTimeMs: finishedAt.getTime() - startedAt.getTime(),
    sampleGames,
  };
}

/** Retry draws until requested successful samples or guard trips. */
export function collectMonteCarloSamples(
  requested: number,
  draw: () => number,
): { samples: number[]; completedSims: number; failedSims: number } {
  const samples: number[] = [];
  let failedSims = 0;
  let guard = 0;
  const maxAttempts = requested * 3;
  while (samples.length < requested && guard < maxAttempts) {
    guard += 1;
    const value = draw();
    if (!Number.isFinite(value)) {
      failedSims += 1;
      continue;
    }
    samples.push(value);
  }
  return { samples, completedSims: samples.length, failedSims };
}

export function aggregatePropBatchSimRun(
  rows: Array<Pick<SimRunStats, "requestedSims" | "completedSims" | "failedSims" | "startedAt" | "finishedAt" | "runTimeMs">>,
  requestedSims: number,
  batchStartedAt: Date,
  batchFinishedAt: Date,
): SimRunStats {
  if (!rows.length) {
    return finalizeSimRunStats(batchStartedAt, requestedSims, 0, 0);
  }
  const completedSims = Math.min(...rows.map((r) => r.completedSims ?? r.simulations ?? 0));
  const failedSims = rows.reduce((n, r) => n + r.failedSims, 0);
  return {
    requestedSims,
    completedSims,
    failedSims,
    actualSimCount: completedSims,
    startedAt: batchStartedAt.toISOString(),
    finishedAt: batchFinishedAt.toISOString(),
    runTimeMs: batchFinishedAt.getTime() - batchStartedAt.getTime(),
  };
}

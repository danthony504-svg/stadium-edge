// Pure helpers for the Home performance sparkline and pick-history screen.
// Every point is derived from REAL settled app picks (win/loss/push) — never
// fabricated trend data.

export const PERFORMANCE_WINDOW = 30;

export type SettledPick = {
  status: "win" | "loss" | "push";
  gradedAt: string;
};

export type RecentPerformance = {
  windowSize: number;
  sampleSize: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number | null;
};

export function isDecided(status: SettledPick["status"]): boolean {
  return status === "win" || status === "loss";
}

/** Rolling win-rate series (0–100) for charting. Needs at least two decided picks. */
export function buildRollingWinRateSeries(
  history: SettledPick[],
  windowSize = PERFORMANCE_WINDOW,
): number[] {
  const decided = history.filter((p) => isDecided(p.status));
  if (decided.length < 2) return [];

  const series: number[] = [];
  for (let i = 0; i < decided.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const slice = decided.slice(start, i + 1);
    const wins = slice.filter((p) => p.status === "win").length;
    series.push(Math.round((wins / slice.length) * 100));
  }
  return series;
}

/** Summary stats for the most recent N settled picks (newest window). */
export function summarizeRecentPerformance(
  history: SettledPick[],
  windowSize = PERFORMANCE_WINDOW,
): RecentPerformance {
  const recent = history.slice(-windowSize);
  const wins = recent.filter((p) => p.status === "win").length;
  const losses = recent.filter((p) => p.status === "loss").length;
  const pushes = recent.filter((p) => p.status === "push").length;
  const decided = wins + losses;
  return {
    windowSize,
    sampleSize: recent.length,
    wins,
    losses,
    pushes,
    winPct: decided > 0 ? Math.round((wins / decided) * 100) : null,
  };
}

export type WonPick<T extends SettledPick> = T & { status: "win" };

/** All winning picks, newest first. */
export function wonPicks<T extends SettledPick>(history: T[]): WonPick<T>[] {
  return history
    .filter((p): p is WonPick<T> => p.status === "win")
    .slice()
    .reverse();
}

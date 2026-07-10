// Learn from graded prop picks across all sports.

import type { PropLearningRow } from "./types.js";

const MIN_SAMPLE = 12;

export function propLearningWeight(
  sport: string,
  market: string,
  history: PropLearningRow[],
): number {
  const key = market.toLowerCase();
  const rows = history.filter(
    (r) => r.sport.toLowerCase() === sport.toLowerCase() && r.market.toLowerCase() === key,
  );
  if (rows.length < MIN_SAMPLE) return 1;
  const wins = rows.filter((r) => r.outcome === "win").length;
  const losses = rows.filter((r) => r.outcome === "loss").length;
  const decided = wins + losses;
  if (decided < MIN_SAMPLE) return 1;
  const hit = wins / decided;
  const w = 0.8 + (hit - 0.5) * 0.6;
  return Math.max(0.8, Math.min(1.2, Math.round(w * 100) / 100));
}

export function buildPropLearningMap(
  sport: string,
  history: PropLearningRow[],
): Record<string, number> {
  const markets = new Set(
    history.filter((r) => r.sport.toLowerCase() === sport.toLowerCase()).map((r) => r.market.toLowerCase()),
  );
  const out: Record<string, number> = {};
  for (const m of markets) out[m] = propLearningWeight(sport, m, history);
  return out;
}

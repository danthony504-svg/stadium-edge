// Learn from graded tennis prop picks — nudges future recommendations by market
// family hit rate (same pattern as marketWeighting.ts for team sports).

export type TennisPropLearningRow = {
  sport: string;
  market: string;
  outcome: "win" | "loss" | "push";
};

const MIN_SAMPLE = 12;

export function tennisPropLearningWeight(
  market: string,
  history: TennisPropLearningRow[],
): number {
  const key = market.toLowerCase();
  const rows = history.filter(
    (r) => r.sport === "tennis" && r.market.toLowerCase() === key,
  );
  if (rows.length < MIN_SAMPLE) return 1;
  const wins = rows.filter((r) => r.outcome === "win").length;
  const losses = rows.filter((r) => r.outcome === "loss").length;
  const decided = wins + losses;
  if (decided < MIN_SAMPLE) return 1;
  const hit = wins / decided;
  // 45% -> 0.9, 55% -> 1.1, clamped
  const w = 0.8 + (hit - 0.5) * 0.6;
  return Math.max(0.8, Math.min(1.2, Math.round(w * 100) / 100));
}

export function buildTennisPropLearningMap(
  history: TennisPropLearningRow[],
): Record<string, number> {
  const markets = new Set(
    history.filter((r) => r.sport === "tennis").map((r) => r.market.toLowerCase()),
  );
  const out: Record<string, number> = {};
  for (const m of markets) {
    out[m] = tennisPropLearningWeight(m, history);
  }
  return out;
}

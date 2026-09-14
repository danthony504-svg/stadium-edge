export type FantasyScoringFormat = "ppr" | "halfPpr" | "standard";

export type FantasyStatLine = {
  passingYards?: number;
  passingTouchdowns?: number;
  interceptions?: number;
  rushingYards?: number;
  rushingTouchdowns?: number;
  receivingYards?: number;
  receivingTouchdowns?: number;
  receptions?: number;
  fumblesLost?: number;
};

export const FANTASY_SCORING_LABELS: Record<FantasyScoringFormat, string> = {
  ppr: "PPR",
  halfPpr: "Half PPR",
  standard: "Standard",
};

/** Pure scoring engine; league settings can extend this without changing UI. */
export function fantasyPoints(
  stats: FantasyStatLine,
  format: FantasyScoringFormat = "ppr",
): number {
  const receptionValue = format === "ppr" ? 1 : format === "halfPpr" ? 0.5 : 0;
  return (
    (stats.passingYards ?? 0) * 0.04 +
    (stats.passingTouchdowns ?? 0) * 4 -
    (stats.interceptions ?? 0) * 2 +
    (stats.rushingYards ?? 0) * 0.1 +
    (stats.rushingTouchdowns ?? 0) * 6 +
    (stats.receivingYards ?? 0) * 0.1 +
    (stats.receivingTouchdowns ?? 0) * 6 +
    (stats.receptions ?? 0) * receptionValue -
    (stats.fumblesLost ?? 0) * 2
  );
}

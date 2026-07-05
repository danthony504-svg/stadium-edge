// Game Simulator presentation helpers — predictions, rankings, progress, and diffs.
import type { GameSimulationResult, PropSimulationResult } from "./api";
import type { CombinedPickScore } from "./pickScore";
import {
  expectedProjection,
  gradeRank,
  meetsSimulatorQualityThreshold,
  simulatorSimConfidence,
} from "./simulatorRecommendations";

export type GameConfidenceLevel = "High" | "Medium" | "Low";

export type PropPickRecommendation = "Best Bet" | "Value" | "Safe" | "Pass";

export type RankedSimulatorProp = {
  key: string;
  row: PropSimulationResult;
  combined: CombinedPickScore;
  rankScore: number;
  recommendation: PropPickRecommendation;
};

export type TopAiPickSlot = {
  id: "bestBet" | "bestValue" | "safest" | "biggestEdge";
  title: string;
  label: string;
  detail: string;
  key: string | null;
};

export type SimProgressStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
};

export const SIM_PROGRESS_STEPS: Omit<SimProgressStep, "status">[] = [
  { id: "lineups", label: "Loading lineups & matchups" },
  { id: "injuries", label: "Checking injuries" },
  { id: "weather", label: "Pulling park weather" },
  { id: "odds", label: "Loading odds & props" },
  { id: "sim", label: "Running Monte Carlo simulations" },
];

export function initialSimProgress(): SimProgressStep[] {
  return SIM_PROGRESS_STEPS.map((s, i) => ({
    ...s,
    status: i === 0 ? "active" : "pending",
  }));
}

export function advanceSimProgress(steps: SimProgressStep[], doneId: string): SimProgressStep[] {
  const order = SIM_PROGRESS_STEPS.map((s) => s.id);
  const doneIndex = order.indexOf(doneId);
  return steps.map((s) => {
    const idx = order.indexOf(s.id);
    if (idx <= doneIndex) return { ...s, status: "done" as const };
    if (idx === doneIndex + 1) return { ...s, status: "active" as const };
    return { ...s, status: "pending" as const };
  });
}

export function completeSimProgress(steps: SimProgressStep[]): SimProgressStep[] {
  return steps.map((s) => ({ ...s, status: "done" as const }));
}

export function gameConfidenceLevel(confidenceScore: number | null | undefined): GameConfidenceLevel {
  if (confidenceScore == null) return "Low";
  if (confidenceScore >= 70) return "High";
  if (confidenceScore >= 50) return "Medium";
  return "Low";
}

export function gameAiPrediction(
  gr: GameSimulationResult,
  homeTeam: string,
  awayTeam: string,
): string {
  const winner = gr.mostLikelyWinner === "home" ? homeTeam : awayTeam;
  const pct = Math.round(gr.mostLikelyWinnerPct * 100);
  const short = winner.split(" ").slice(-1)[0] ?? winner;
  return `${short} to win (${pct}% sim probability)`;
}

export function mostLikelyFinalScore(gr: GameSimulationResult): { away: number; home: number } {
  return {
    away: Math.max(0, Math.round(gr.awayProjectedScore)),
    home: Math.max(0, Math.round(gr.homeProjectedScore)),
  };
}

export function formatFinalScoreLine(
  awayTeam: string,
  homeTeam: string,
  gr: GameSimulationResult,
): string {
  const { away, home } = mostLikelyFinalScore(gr);
  const awayShort = awayTeam.split(" ").slice(-1)[0] ?? awayTeam;
  const homeShort = homeTeam.split(" ").slice(-1)[0] ?? homeTeam;
  return `${awayShort} ${away} – ${homeShort} ${home}`;
}

export function formatAverageScoreLine(
  awayTeam: string,
  homeTeam: string,
  gr: GameSimulationResult,
): string {
  const awayShort = awayTeam.split(" ").slice(-1)[0] ?? awayTeam;
  const homeShort = homeTeam.split(" ").slice(-1)[0] ?? homeTeam;
  return `${awayShort} ${gr.awayProjectedScore.toFixed(1)} – ${homeShort} ${gr.homeProjectedScore.toFixed(1)}`;
}

export function propPickRecommendation(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
): PropPickRecommendation {
  const composite = combined?.composite ?? null;
  const edge = combined?.edgePct ?? null;
  const hit = simRow?.hitProbability ?? null;
  const conf = combined?.confidencePct ?? null;

  if (
    meetsSimulatorQualityThreshold(combined) &&
    composite != null &&
    composite >= 8 &&
    hit != null &&
    hit >= 0.55
  ) {
    return "Best Bet";
  }
  if (meetsSimulatorQualityThreshold(combined) && edge != null && edge >= 2.5) {
    return "Value";
  }
  if (
    gradeRank(combined?.grade) >= gradeRank("B") &&
    hit != null &&
    hit >= 0.58 &&
    conf != null &&
    conf >= 62
  ) {
    return "Safe";
  }
  if (meetsSimulatorQualityThreshold(combined)) return "Value";
  if (gradeRank(combined?.grade) >= gradeRank("B-") && edge != null && edge > 0) return "Value";
  return "Pass";
}

export function propRankScore(
  combined: CombinedPickScore,
  simRow: PropSimulationResult | null | undefined,
): number {
  const composite = combined.composite ?? 0;
  const edge = combined.edgePct ?? 0;
  const conf = combined.confidencePct ?? 0;
  const hit = simRow?.hitProbability ?? 0;
  const simConf = simRow ? simulatorSimConfidence(simRow) ?? 0 : 0;
  return composite * 4 + edge * 0.8 + conf * 0.05 + hit * 10 + simConf * 0.04;
}

export function rankSimulatorProps(
  rows: PropSimulationResult[],
  scores: Map<string, CombinedPickScore>,
): RankedSimulatorProp[] {
  return rows
    .map((row) => {
      const combined = scores.get(row.key);
      if (!combined) return null;
      return {
        key: row.key,
        row,
        combined,
        rankScore: propRankScore(combined, row),
        recommendation: propPickRecommendation(combined, row),
      };
    })
    .filter((x): x is RankedSimulatorProp => x != null)
    .sort((a, b) => b.rankScore - a.rankScore);
}

function propLabel(row: PropSimulationResult, marketLabel: string): string {
  return `${row.player} ${row.side} ${row.line} ${marketLabel}`;
}

export function buildTopAiPicks(
  ranked: RankedSimulatorProp[],
  marketLabelFn: (market: string) => string,
): TopAiPickSlot[] {
  const quality = ranked.filter((r) => meetsSimulatorQualityThreshold(r.combined));
  const pool = quality.length ? quality : ranked;

  const bestBet = [...pool].sort((a, b) => (b.combined.composite ?? 0) - (a.combined.composite ?? 0))[0];
  const bestValue = [...pool].sort((a, b) => (b.combined.edgePct ?? 0) - (a.combined.edgePct ?? 0))[0];
  const safest = [...pool].sort((a, b) => {
    const ah = a.row.hitProbability ?? 0;
    const bh = b.row.hitProbability ?? 0;
    if (bh !== ah) return bh - ah;
    return (b.combined.confidencePct ?? 0) - (a.combined.confidencePct ?? 0);
  })[0];
  const biggestEdge = [...ranked].sort((a, b) => (b.combined.edgePct ?? 0) - (a.combined.edgePct ?? 0))[0];

  const slot = (
    id: TopAiPickSlot["id"],
    title: string,
    pick: RankedSimulatorProp | undefined,
  ): TopAiPickSlot => ({
    id,
    title,
    label: pick ? propLabel(pick.row, marketLabelFn(pick.row.market)) : "—",
    detail: pick
      ? `Grade ${pick.combined.grade ?? "—"} · ${pick.recommendation}`
      : "No pick qualified",
    key: pick?.key ?? null,
  });

  return [
    slot("bestBet", "Best Bet", bestBet),
    slot("bestValue", "Best Value", bestValue),
    slot("safest", "Safest Pick", safest),
    slot("biggestEdge", "Biggest Edge", biggestEdge),
  ];
}

export type SimRunSnapshot = {
  gameId: string;
  winnerSide: "home" | "away" | null;
  winPct: number | null;
  awayScore: number | null;
  homeScore: number | null;
  topPropKey: string | null;
  weatherLabel: string;
  injuryCount: number;
  ranAt: number;
};

export function buildSimSnapshot(args: {
  gameId: string;
  gameResult: GameSimulationResult | null;
  topPropKey: string | null;
  weatherLabel: string;
  injuryCount: number;
}): SimRunSnapshot {
  return {
    gameId: args.gameId,
    winnerSide: args.gameResult?.mostLikelyWinner ?? null,
    winPct: args.gameResult?.mostLikelyWinnerPct ?? null,
    awayScore: args.gameResult?.awayProjectedScore ?? null,
    homeScore: args.gameResult?.homeProjectedScore ?? null,
    topPropKey: args.topPropKey,
    weatherLabel: args.weatherLabel,
    injuryCount: args.injuryCount,
    ranAt: Date.now(),
  };
}

export function whatChangedSinceLastRun(
  prev: SimRunSnapshot | null,
  next: SimRunSnapshot,
  teams: { home: string; away: string },
): string[] {
  if (!prev || prev.gameId !== next.gameId) return [];
  const out: string[] = [];

  if (prev.winnerSide && next.winnerSide && prev.winnerSide !== next.winnerSide) {
    const team = next.winnerSide === "home" ? teams.home : teams.away;
    out.push(`AI prediction flipped to ${team.split(" ").slice(-1)[0]}.`);
  } else if (
    prev.winPct != null &&
    next.winPct != null &&
    Math.abs(prev.winPct - next.winPct) >= 0.04
  ) {
    const dir = next.winPct > prev.winPct ? "rose" : "dropped";
    out.push(`Win probability ${dir} ${Math.round(Math.abs(next.winPct - prev.winPct) * 100)} pts.`);
  }

  if (
    prev.awayScore != null &&
    next.awayScore != null &&
    prev.homeScore != null &&
    next.homeScore != null &&
    (Math.abs(prev.awayScore - next.awayScore) >= 0.35 ||
      Math.abs(prev.homeScore - next.homeScore) >= 0.35)
  ) {
    out.push("Projected scoring shifted based on new inputs.");
  }

  if (prev.weatherLabel !== next.weatherLabel && next.weatherLabel !== "—") {
    out.push(`Weather update: ${next.weatherLabel}.`);
  }

  if (Math.abs(prev.injuryCount - next.injuryCount) >= 1) {
    out.push(
      next.injuryCount > prev.injuryCount
        ? "New injuries were factored into the model."
        : "Injury report cleared up since the last run.",
    );
  }

  if (prev.topPropKey && next.topPropKey && prev.topPropKey !== next.topPropKey) {
    out.push("Top prop recommendation changed after re-simulating lines.");
  }

  if (!out.length && prev.ranAt > 0) {
    out.push("Lines and inputs are stable — prediction held steady.");
  }

  return out.slice(0, 4);
}

export function simulationImpactNotes(args: {
  sport: string;
  weatherImpact: number | null;
  weatherLabel: string;
  injuryCount: number;
  lineCount: number;
}): string[] {
  const notes: string[] = [];
  if (args.sport === "mlb" && args.weatherImpact != null && args.weatherLabel !== "—") {
  notes.push(
      `Weather (${args.weatherLabel}) is baked into run scoring and hitter-friendly prop markets.`,
    );
  } else if (args.weatherImpact != null && args.weatherLabel !== "—") {
    notes.push(`Weather conditions (${args.weatherLabel}) were included where the model supports them.`);
  }
  if (args.injuryCount > 0) {
    notes.push(
      `${args.injuryCount} key injury${args.injuryCount === 1 ? "" : "ies"} adjusted game and prop projections.`,
    );
  }
  if (args.lineCount > 0) {
    notes.push(`${args.lineCount} posted prop lines were graded against live odds and simulation.`);
  }
  return notes;
}

export { expectedProjection as expectedStat };

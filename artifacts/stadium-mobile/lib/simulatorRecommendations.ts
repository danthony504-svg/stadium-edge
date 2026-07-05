// Game Simulator quality gates, recommendation labels, and "why this pick" copy.
import type { PropSimulationResult } from "./api";
import type { CombinedPickScore, PickSubScores } from "./pickScore";
import { resolveSimConfidence } from "./propSimFallback";

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

export const SIM_MIN_GRADE = "B";

export function gradeRank(grade: string | null | undefined): number {
  if (!grade) return -1;
  return GRADE_RANK[grade] ?? -1;
}

/** Default simulator filter: AI Grade B+ or better is NOT what user asked — they said B or higher. */
export function meetsSimulatorQualityThreshold(
  combined: CombinedPickScore | null | undefined,
): boolean {
  if (!combined?.grade) return false;
  if (gradeRank(combined.grade) < gradeRank(SIM_MIN_GRADE)) return false;
  if (combined.edgePct == null || combined.edgePct <= 0) return false;
  return true;
}

export function expectedProjection(row: PropSimulationResult): string | null {
  const v = row.meanProjection ?? row.medianProjection ?? row.mostLikelyLine;
  if (v == null || !Number.isFinite(v)) return null;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function simulatorSimConfidence(row: PropSimulationResult): number | null {
  return resolveSimConfidence(row);
}

export function simulatorRecommendation(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
): string {
  const composite = combined?.composite;
  const edge = combined?.edgePct ?? null;
  const hit = simRow?.hitProbability ?? null;
  const simConf = simRow ? resolveSimConfidence(simRow) : null;

  if (
    composite != null &&
    composite >= 8 &&
    edge != null &&
    edge > 0 &&
    hit != null &&
    hit >= 0.55 &&
    (simConf ?? 0) >= 55
  ) {
    return "Strong Play";
  }
  if (meetsSimulatorQualityThreshold(combined) && hit != null && hit >= 0.52) {
    return "Play";
  }
  if (composite != null && gradeRank(combined?.grade) >= gradeRank("B-") && edge != null && edge >= 0) {
    return "Lean";
  }
  if (composite != null && composite >= 5.5) return "Monitor";
  return "Pass";
}

const REASON_LABELS: Record<keyof PickSubScores, string> = {
  matchup: "Matchup",
  trend: "Recent form",
  lineValue: "Line value",
  injury: "Injuries",
  lineShopping: "Line shopping",
  simulation: "Simulation",
};

function reasonForFactor(
  key: keyof PickSubScores,
  score: number,
  edgePct: number | null,
  hitPct: number | null,
): string | null {
  switch (key) {
    case "matchup":
      if (score >= 7.5) return "Matchup history favors this side";
      if (score >= 6.5) return "Slight matchup edge in this spot";
      return null;
    case "trend":
      if (score >= 7.5) return "Recent games trend strongly toward this line";
      if (score >= 6.5) return "Recent form supports clearing the number";
      return null;
    case "lineValue":
      if (edgePct != null && edgePct > 0) {
        return `+${edgePct}% edge vs fair odds`;
      }
      if (score >= 6.5) return "Posted line looks favorable";
      return null;
    case "injury":
      if (score >= 7) return "Injury report favors this pick";
      if (score >= 6.5) return "Opponent injuries create a small edge";
      return null;
    case "lineShopping":
      if (score >= 7) return "Best available price beats the market";
      if (score >= 6.5) return "Price beats cross-book consensus";
      return null;
    case "simulation":
      if (hitPct != null && hitPct >= 0.6) {
        return `Simulation shows ${Math.round(hitPct * 100)}% hit rate`;
      }
      if (score >= 7) return "Monte Carlo leans toward this side";
      if (score >= 6.5) return "Model simulation supports the line";
      return null;
    default:
      return null;
  }
}

/** Top 2–3 human-readable reasons for the pick card. */
export function topSimulatorPickReasons(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
  limit = 3,
): string[] {
  if (!combined?.scores) return [];
  const hit = simRow?.hitProbability ?? null;
  const ranked = (Object.keys(REASON_LABELS) as Array<keyof PickSubScores>)
    .map((key) => {
      const score = combined.scores[key];
      if (score == null || !Number.isFinite(score)) return null;
      const text = reasonForFactor(key, score, combined.edgePct, hit);
      if (!text) return null;
      return { key, score, text };
    })
    .filter((x): x is { key: keyof PickSubScores; score: number; text: string } => x != null)
    .sort((a, b) => b.score - a.score);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (seen.has(r.text)) continue;
    seen.add(r.text);
    out.push(r.text);
    if (out.length >= limit) break;
  }
  return out;
}

export function recommendationTone(
  rec: string,
): "strong" | "play" | "lean" | "monitor" | "pass" {
  if (rec === "Strong Play") return "strong";
  if (rec === "Play") return "play";
  if (rec === "Lean") return "lean";
  if (rec === "Monitor") return "monitor";
  return "pass";
}

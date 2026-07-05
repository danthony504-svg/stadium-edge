// Game Simulator quality gates, recommendation labels, and "why this pick" copy.
import type { PropSimulationResult } from "./api";
import type { CombinedPickScore, PickSubScores } from "./pickScore";
import { resolveSimConfidence } from "./propSimFallback";
import {
  isDeepMonteCarloComplete,
  isValidPropSimData,
  resolveDisplayEdge,
} from "./simPropValidity";

export { resolveDisplayEdge } from "./simPropValidity";

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

/** Below this sim hit rate we label the prop Pass (not recommended). */
export const MIN_SIM_HIT_RECOMMEND = 0.52;

export const SIM_MIN_GRADE = "B";

export function gradeRank(grade: string | null | undefined): number {
  if (!grade) return -1;
  return GRADE_RANK[grade] ?? -1;
}

export function isLowGrade(grade: string | null | undefined): boolean {
  return gradeRank(grade) <= gradeRank("D");
}

/** Default list filter: hide D/F, negative edge, and props without valid sim data. */
export function isVisibleByDefault(
  combined: CombinedPickScore | null | undefined,
  simRow?: PropSimulationResult | null,
): boolean {
  if (!combined?.grade) return false;
  if (isLowGrade(combined.grade)) return false;
  if (combined.edgePct == null || combined.edgePct < 0) {
    const simEdge = resolveDisplayEdge(combined, simRow);
    if (simEdge == null || simEdge < 0) return false;
  }
  if (simRow && !isValidPropSimData(simRow)) return false;
  return true;
}

/** Stricter bar for Top AI Picks tiles — Grade B+ with real edge and sim support. */
export function meetsSimulatorQualityThreshold(
  combined: CombinedPickScore | null | undefined,
  simRow?: PropSimulationResult | null,
): boolean {
  if (!isRecommendableProp(combined, simRow)) return false;
  if (gradeRank(combined?.grade) < gradeRank(SIM_MIN_GRADE)) return false;
  return true;
}

/** Recommendable = valid deep Monte Carlo, positive edge, not D/F, sim hit above floor. */
export function isRecommendableProp(
  combined: CombinedPickScore | null | undefined,
  simRow?: PropSimulationResult | null,
): boolean {
  if (!combined?.grade) return false;
  if (isLowGrade(combined.grade)) return false;
  if (!simRow || !isValidPropSimData(simRow)) return false;
  if (!isDeepMonteCarloComplete(simRow)) return false;
  const edge = resolveDisplayEdge(combined, simRow);
  if (edge == null || edge <= 0) return false;
  const hit = simRow.hitProbability;
  if (hit == null || hit < MIN_SIM_HIT_RECOMMEND) return false;
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

const REASON_LABELS: Record<keyof PickSubScores, string> = {
  matchup: "Matchup",
  trend: "Recent form",
  lineValue: "Line value",
  injury: "Injuries",
  lineShopping: "Line shopping",
  simulation: "Simulation",
};

function shortReasonForFactor(
  key: keyof PickSubScores,
  score: number,
  edgePct: number | null,
  hitPct: number | null,
): string | null {
  switch (key) {
    case "matchup":
      if (score >= 6.5) return "Strong matchup";
      return null;
    case "trend":
      if (score >= 6.5) return "Hot recent form";
      return null;
    case "lineValue":
      if (edgePct != null && edgePct > 0) return "Positive line value";
      if (score >= 6.5) return "Favorable posted line";
      return null;
    case "injury":
      if (score >= 6.5) return "Injury edge";
      return null;
    case "lineShopping":
      if (score >= 6.5) return "Positive line movement";
      return null;
    case "simulation":
      if (hitPct != null && hitPct >= 0.55) return "High simulation hit rate";
      if (score >= 6.5) return "Simulation supports the line";
      return null;
    default:
      return null;
  }
}

/** Top 1–3 short reasons for the pick card. */
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
      const text = shortReasonForFactor(key, score, combined.edgePct, hit);
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

export function primaryPickReason(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
): string | null {
  return topSimulatorPickReasons(combined, simRow, 1)[0] ?? null;
}

export function formatEdgeDisplay(edgePct: number | null | undefined): string {
  if (edgePct == null || !Number.isFinite(edgePct)) return "—";
  return `${edgePct > 0 ? "+" : ""}${edgePct}%`;
}

export function formatSimHitDisplay(hit: number | null | undefined): string {
  if (hit == null || !Number.isFinite(hit)) return "—";
  return `${Math.round(hit * 100)}%`;
}

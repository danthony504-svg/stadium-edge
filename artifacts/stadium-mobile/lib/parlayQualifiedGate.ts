// Pure qualification gate — no API / React imports (testable in Node).

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FinalAiScore } from "./finalAiScore.ts";
import { GAME_SIM_MIN_HIT, isGameLinePick } from "./gameSimScoring.ts";

/** Props: complete scores + positive edge + sim alignment or high-risk value play. */
export function isFullyQualifiedPropFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  if (!score) return false;
  if (!score.grade) return false;
  if (score.simHit == null || !Number.isFinite(score.simHit)) return false;
  if (score.edgePct == null || !Number.isFinite(score.edgePct) || score.edgePct <= 0) return false;
  if (score.confidencePct == null || !Number.isFinite(score.confidencePct)) return false;
  if (score.composite == null || !Number.isFinite(score.composite) || score.composite <= 0) return false;
  if (odds == null || !Number.isFinite(odds)) return false;
  if (!score.simAligned && !score.highRiskValuePlay) return false;
  return true;
}

/**
 * Game lines: stricter bar — sim cover above the 52% floor (not 50%), positive
 * edge + Final AI Score, complete transparency fields, and sim must agree with
 * the AI Coach (no high-risk value bypass on game lines).
 */
export function isFullyQualifiedGameLineFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  if (!score) return false;
  if (!score.grade) return false;
  if (score.simHit == null || !Number.isFinite(score.simHit)) return false;
  if (score.simHit < GAME_SIM_MIN_HIT) return false;
  if (score.edgePct == null || !Number.isFinite(score.edgePct) || score.edgePct <= 0) return false;
  if (score.confidencePct == null || !Number.isFinite(score.confidencePct)) return false;
  if (score.composite == null || !Number.isFinite(score.composite) || score.composite <= 0) return false;
  if (odds == null || !Number.isFinite(odds)) return false;
  if (!score.simAligned) return false;
  return true;
}

/** @deprecated Use isFullyQualifiedPropFinalAi or isFullyQualifiedGameLineFinalAi */
export function isFullyQualifiedFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  return isFullyQualifiedPropFinalAi(score, odds);
}

export function isFullyQualifiedPick(pick: ParsedPick): boolean {
  const score = pick.finalAiScore;
  const odds = pick.odds ?? null;
  if (pick.isProp) return isFullyQualifiedPropFinalAi(score, odds);
  if (isGameLinePick(pick) && !pick.isProp) {
    return isFullyQualifiedGameLineFinalAi(score, odds);
  }
  return isFullyQualifiedPropFinalAi(score, odds);
}

export function reasonPickNotQualified(pick: ParsedPick): string {
  const s = pick.finalAiScore;
  const isGame = isGameLinePick(pick) && !pick.isProp;
  if (!s) return "missing Final AI Score";
  if (!s.grade) return "missing AI Grade";
  if (s.simHit == null) return "missing Simulation Hit %";
  if (s.simHit < GAME_SIM_MIN_HIT && isGame) {
    const pct = Math.round(s.simHit * 100);
    return `10k sim ${pct}% cover — game lines need ≥${Math.round(GAME_SIM_MIN_HIT * 100)}%`;
  }
  if (s.edgePct == null) return "missing Edge %";
  if (s.edgePct <= 0) return `${s.edgePct}% edge — needs positive EV`;
  if (s.confidencePct == null) return "missing Confidence";
  if (s.composite == null || s.composite <= 0) return "missing or non-positive Final AI Score";
  if (pick.odds == null || !Number.isFinite(pick.odds)) return "no real sportsbook odds";
  if (isGame && !s.simAligned) {
    const pct = Math.round(s.simHit * 100);
    return `Game simulator (${pct}% cover) disagrees with AI Coach — game lines must be sim-aligned`;
  }
  if (!s.simAligned && !s.highRiskValuePlay) {
    const pct = Math.round(s.simHit * 100);
    return `10k sim ${pct}% hit — needs ≥52% cover or High-Risk Value Play (+4.5% edge)`;
  }
  return "quality bar not met";
}

export function nearScoreFromPick(pick: ParsedPick): number {
  const s = pick.finalAiScore;
  const sim = s?.simHit ?? 0;
  const edge = s?.edgePct ?? 0;
  const composite = s?.composite ?? 0;
  const simBonus = s?.simAligned ? 8 : 0;
  return composite * 10 + sim * 50 + Math.max(0, edge) * 3 + simBonus;
}

export function partitionQualifiedPicks(picks: ParsedPick[]): {
  qualified: ParsedPick[];
  unqualified: ParsedPick[];
} {
  const qualified: ParsedPick[] = [];
  const unqualified: ParsedPick[] = [];
  for (const p of picks) {
    if (isFullyQualifiedPick(p)) qualified.push(p);
    else unqualified.push(p);
  }
  return { qualified, unqualified };
}

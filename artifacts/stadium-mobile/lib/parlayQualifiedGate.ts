// Pure qualification gate — no API / React imports (testable in Node).

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FinalAiScore } from "./finalAiScore.ts";

/** True when every required transparency field is grounded on real data. */
export function isFullyQualifiedFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  if (!score) return false;
  if (!score.grade) return false;
  if (score.simHit == null || !Number.isFinite(score.simHit)) return false;
  if (score.edgePct == null || !Number.isFinite(score.edgePct) || score.edgePct <= 0) return false;
  if (score.confidencePct == null || !Number.isFinite(score.confidencePct)) return false;
  if (score.composite == null || !Number.isFinite(score.composite)) return false;
  if (odds == null || !Number.isFinite(odds)) return false;
  if (!score.simAligned && !score.highRiskValuePlay) return false;
  return true;
}

export function isFullyQualifiedPick(pick: ParsedPick): boolean {
  return isFullyQualifiedFinalAi(pick.finalAiScore, pick.odds ?? null);
}

export function reasonPickNotQualified(pick: ParsedPick): string {
  const s = pick.finalAiScore;
  if (!s) return "missing Final AI Score";
  if (!s.grade) return "missing AI Grade";
  if (s.simHit == null) return "missing Simulation Hit %";
  if (s.edgePct == null) return "missing Edge %";
  if (s.edgePct <= 0) return `${s.edgePct}% edge — needs positive EV`;
  if (s.confidencePct == null) return "missing Confidence";
  if (s.composite == null) return "missing Final AI Score composite";
  if (pick.odds == null || !Number.isFinite(pick.odds)) return "no real sportsbook odds";
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
  return composite * 0.5 + sim * 40 + Math.max(0, edge) * 2;
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

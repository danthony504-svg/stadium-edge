// Pure qualification gate — no API / React imports (testable in Node).

import type { ParsedPick } from "../components/PickCard.tsx";
import { gradeRank } from "./finalAiScore.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { GAME_SIM_MIN_HIT } from "./gameSimScoring.ts";

export const MIN_MAIN_PICK_GRADE = "C";
export const MIN_MAIN_PICK_CONFIDENCE = 50;

function gradeMeetsMinimum(grade: string | null | undefined, minGrade: string): boolean {
  return gradeRank(grade) >= gradeRank(minGrade);
}

/**
 * Main-ticket quality bar — applies to every game line and prop on the primary
 * parlay. Rejects losing-value picks: grade below C, negative edge/EV,
 * confidence under 50%, or simulator disagreement.
 */
export function isMainTicketQualified(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  if (!score) return false;
  if (!score.grade || !gradeMeetsMinimum(score.grade, MIN_MAIN_PICK_GRADE)) return false;
  if (score.edgePct == null || !Number.isFinite(score.edgePct) || score.edgePct <= 0) return false;
  if (score.confidencePct == null || score.confidencePct < MIN_MAIN_PICK_CONFIDENCE) return false;
  if (score.simHit == null || !Number.isFinite(score.simHit) || score.simHit < GAME_SIM_MIN_HIT) {
    return false;
  }
  if (!score.simAligned) return false;
  if (score.composite == null || !Number.isFinite(score.composite) || score.composite <= 0) {
    return false;
  }
  if (odds == null || !Number.isFinite(odds)) return false;
  return true;
}

/** @deprecated Alias for isMainTicketQualified */
export function isFullyQualifiedPropFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  return isMainTicketQualified(score, odds);
}

/** @deprecated Alias for isMainTicketQualified */
export function isFullyQualifiedGameLineFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  return isMainTicketQualified(score, odds);
}

/** @deprecated Alias for isMainTicketQualified */
export function isFullyQualifiedFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  return isMainTicketQualified(score, odds);
}

export function isFullyQualifiedPick(pick: ParsedPick): boolean {
  return isMainTicketQualified(pick.finalAiScore, pick.odds ?? null);
}

/** Negative-edge or sim-opposed legs for the optional longshot section only. */
export function isLongshotSectionPick(pick: ParsedPick): boolean {
  const s = pick.finalAiScore;
  if (!s?.grade || pick.odds == null || !Number.isFinite(pick.odds)) return false;
  const negativeEdge = s.edgePct == null || s.edgePct <= 0;
  const simUnsupported = !s.simAligned || s.simHit == null || s.simHit < GAME_SIM_MIN_HIT;
  if (!negativeEdge && !simUnsupported) return false;
  return s.simHit != null || s.edgePct != null;
}

export function reasonPickNotQualified(pick: ParsedPick): string {
  const s = pick.finalAiScore;
  if (!s) return "missing Final AI Score";
  if (!s.grade) return "missing AI Grade";
  if (!gradeMeetsMinimum(s.grade, MIN_MAIN_PICK_GRADE)) {
    return `AI Grade ${s.grade} — main picks need C or better`;
  }
  if (s.edgePct == null) return "missing Edge %";
  if (s.edgePct <= 0) return `${s.edgePct}% edge — negative EV, rejected`;
  if (s.confidencePct == null) return "missing Confidence";
  if (s.confidencePct < MIN_MAIN_PICK_CONFIDENCE) {
    return `Confidence ${s.confidencePct}% — needs ≥${MIN_MAIN_PICK_CONFIDENCE}%`;
  }
  if (s.simHit == null) return "missing Simulation Hit %";
  if (s.simHit < GAME_SIM_MIN_HIT) {
    const pct = Math.round(s.simHit * 100);
    return `10k sim ${pct}% — simulator does not support this pick (needs ≥${Math.round(GAME_SIM_MIN_HIT * 100)}%)`;
  }
  if (!s.simAligned) {
    const pct = Math.round(s.simHit * 100);
    return `Game simulator (${pct}% cover) disagrees with AI Coach`;
  }
  if (s.composite == null || s.composite <= 0) return "non-positive Final AI Score / EV";
  if (pick.odds == null || !Number.isFinite(pick.odds)) return "no real sportsbook odds";
  return "quality bar not met";
}

/**
 * Ranking priority for main-ticket selection:
 * 1. Positive edge  2. Simulation support  3. Confidence
 * 4. AI Grade  5. Best available odds (higher payout)
 */
export function comparePickStrength(a: ParsedPick, b: ParsedPick): number {
  const sa = a.finalAiScore;
  const sb = b.finalAiScore;
  const edgeA = sa?.edgePct ?? -999;
  const edgeB = sb?.edgePct ?? -999;
  if (edgeB !== edgeA) return edgeB - edgeA;

  const simA = sa?.simHit ?? 0;
  const simB = sb?.simHit ?? 0;
  if (simB !== simA) return simB - simA;

  const confA = sa?.confidencePct ?? 0;
  const confB = sb?.confidencePct ?? 0;
  if (confB !== confA) return confB - confA;

  const gradeA = gradeRank(sa?.grade);
  const gradeB = gradeRank(sb?.grade);
  if (gradeB !== gradeA) return gradeB - gradeA;

  const oddsA = a.odds ?? -9999;
  const oddsB = b.odds ?? -9999;
  return oddsB - oddsA;
}

export function nearScoreFromPick(pick: ParsedPick): number {
  const s = pick.finalAiScore;
  const edge = Math.max(0, s?.edgePct ?? 0);
  const sim = s?.simHit ?? 0;
  const conf = s?.confidencePct ?? 0;
  const grade = gradeRank(s?.grade);
  const odds = pick.odds ?? -999;
  return edge * 1000 + sim * 500 + conf * 2 + grade * 10 + odds * 0.01;
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

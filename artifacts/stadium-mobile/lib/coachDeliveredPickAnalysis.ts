// Coach delivered-pick analysis — preserve full scored objects for card rendering.
// Fallback selection relaxes eligibility; display must keep the complete analysis model.

import type { ParsedPick } from "./parsedPick.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import {
  buildCoachCardHolistic,
  resolvePropHolisticForDisplay,
  type PropHolisticScore,
} from "./propHolisticRecommendation.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";

export type CoachDeliveryTier = 1 | 2 | 3 | 4;

function gradeRank(g: string | null | undefined): number {
  const GRADE_RANK: Record<string, number> = {
    F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
  };
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

/** True when this leg was included on a delivered Coach ticket (any tier). */
export function coachPickIsDelivered(
  pick: ParsedPick & {
    coachDelivered?: boolean;
    coachFillTier?: string;
    coachConfidenceLabel?: string;
    coachDeliveryTier?: CoachDeliveryTier;
  },
): boolean {
  return !!(
    pick.coachDelivered ||
    pick.coachDeliveryTier ||
    pick.coachFillTier ||
    pick.coachConfidenceLabel === "Medium confidence"
  );
}

function resolveHolisticForDeliveredPick(pick: ParsedPick): PropHolisticScore | null {
  return buildCoachCardHolistic(pick) ?? pick.finalAiScore?.propHolistic ?? resolvePropHolisticForDisplay(pick);
}

function displayGradeFromPick(pick: ParsedPick, score: FinalAiScore, holistic: PropHolisticScore | null): string | null {
  if (pick.coachFillTier && score.grade) {
    return gradeRank(score.grade) >= gradeRank(pick.coachFillTier) ? score.grade : pick.coachFillTier;
  }
  if (pick.coachConfidenceLabel === "Medium confidence") {
    return holistic?.grade ?? score.grade ?? pick.scores?.grade ?? null;
  }
  if (coachPickIsDelivered(pick)) {
    return score.grade ?? pick.scores?.grade ?? holistic?.grade ?? null;
  }
  return holistic?.grade ?? score.grade ?? pick.scores?.grade ?? null;
}

function displayConfidenceFromPick(
  pick: ParsedPick,
  score: FinalAiScore,
  holistic: PropHolisticScore | null,
): number | null {
  if (pick.coachConfidenceLabel === "Medium confidence") {
    return holistic?.confidencePct ?? score.confidencePct ?? null;
  }
  if (coachPickIsDelivered(pick)) {
    return score.confidencePct ?? holistic?.confidencePct ?? null;
  }
  return holistic?.confidencePct ?? score.confidencePct ?? null;
}

/** Merge synthesized holistic onto the scored pick without dropping sim/rubric fields. */
export function ensureCoachDeliveredPickAnalysis<T extends ParsedPick>(pick: T): T {
  const score = pick.finalAiScore;
  if (!score || !pickHasSimGrade(pick, score.simHit)) {
    return { ...pick, coachDelivered: true };
  }

  const holistic = resolveHolisticForDeliveredPick(pick);
  const grade = displayGradeFromPick(pick, score, holistic);
  const confidencePct = displayConfidenceFromPick(pick, score, holistic);
  const composite = score.composite ?? pick.scores?.composite ?? holistic?.composite ?? null;

  const rubric = score.rubric ?? pick.scores;
  const mergedRubric = rubric
    ? {
        ...rubric,
        composite: composite ?? rubric.composite,
        grade: grade ?? rubric.grade,
        confidencePct: confidencePct ?? rubric.confidencePct,
        edgePct: score.edgePct ?? rubric.edgePct,
      }
    : rubric;

  return {
    ...pick,
    coachDelivered: true,
    scores: pick.scores ?? mergedRubric ?? undefined,
    finalAiScore: {
      ...score,
      composite,
      grade,
      confidencePct,
      rubric: mergedRubric ?? score.rubric,
      propHolistic: holistic ?? score.propHolistic ?? null,
    },
  };
}

export function ensureCoachDeliveredPickAnalyses<T extends ParsedPick>(picks: T[]): T[] {
  return picks.map((p) => ensureCoachDeliveredPickAnalysis(p));
}

/** Display gate — delivered legs always show their letter grade, never Not Rec. */
export function coachPickShowsDeliveredGrade(
  pick: ParsedPick & {
    coachDelivered?: boolean;
    coachFillTier?: string;
    coachConfidenceLabel?: string;
    coachDeliveryTier?: CoachDeliveryTier;
    ticketRole?: "main" | "alt";
    odds?: number | null;
    propIsAlt?: boolean;
    isProp?: boolean;
  },
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score || !pickHasSimGrade(pick, score.simHit)) return false;
  if (coachPickIsDelivered(pick)) return true;
  if (pick.coachFillTier && (score.edgePct ?? 0) > 0) return true;
  return false;
}

export function coachPickDisplayGrade(
  pick: ParsedPick & {
    scores?: { grade?: string | null } | null;
    coachFillTier?: string;
    coachConfidenceLabel?: string;
    coachDelivered?: boolean;
    coachDeliveryTier?: CoachDeliveryTier;
  },
  score: FinalAiScore | null | undefined,
): string | null {
  if (!score || !pickHasSimGrade(pick, score.simHit)) return null;
  if (!coachPickShowsDeliveredGrade(pick, score)) return null;
  const holistic = score.propHolistic ?? resolveHolisticForDeliveredPick(pick);
  return displayGradeFromPick(pick, score, holistic);
}

export function coachPickDisplayCaption(
  pick: ParsedPick & {
    coachDelivered?: boolean;
    coachFillTier?: string;
    coachConfidenceLabel?: string;
    coachDeliveryTier?: CoachDeliveryTier;
    coachAlternateLineLabel?: string;
    ticketRole?: "main" | "alt";
    injuryDataUnavailable?: boolean;
  },
  score: FinalAiScore | null | undefined,
): string {
  if (pick.coachConfidenceLabel === "Medium confidence") {
    const missing = score?.propHolistic?.missingCount ?? 0;
    const inj =
      pick.injuryDataUnavailable || score?.propHolistic?.factors.some((f) => f.key === "injury" && !f.present);
    const parts = ["Medium confidence — real posted line with positive edge"];
    if (missing > 0) parts.push(`${missing} optional signal${missing === 1 ? "" : "s"} unavailable`);
    if (inj) parts.push("injury data unavailable");
    return parts.join(" · ");
  }
  if (pick.coachAlternateLineLabel === "Alternate line" || pick.coachDeliveryTier === 3) {
    return "Alternate line — full sim and edge scoring on a posted alt rung";
  }
  if (pick.coachFillTier) {
    return `Tier-relaxed fill at ${pick.coachFillTier} — sim, edge, and EV verified on a posted line`;
  }
  if (pick.coachDelivered) {
    return "Delivered on your requested ticket — full AI analysis preserved";
  }
  return "";
}

/** Tag tier metadata without rebuilding or trimming the scored pick. */
export function tagCoachDeliveryTier(
  pick: ParsedPick,
  tier: CoachDeliveryTier,
): ParsedPick {
  if (tier === 2) {
    return {
      ...pick,
      coachDelivered: true,
      coachDeliveryTier: 2,
      coachConfidenceLabel: "Medium confidence",
    };
  }
  if (tier === 3) {
    return {
      ...pick,
      coachDelivered: true,
      coachDeliveryTier: 3,
      coachAlternateLineLabel: "Alternate line",
      ticketRole: "alt",
    };
  }
  if (tier === 4) {
    return {
      ...pick,
      coachDelivered: true,
      coachDeliveryTier: 4,
    };
  }
  return { ...pick, coachDelivered: true, coachDeliveryTier: 1 };
}

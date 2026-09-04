// Coach ticket rescore helpers — avoids a pickRecommendation ↔ pickScoreContext cycle.

import type { ParsedPick } from "./parsedPick.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import {
  rescoreCoachTicketPicks,
  type CoachFlashEnrich,
} from "./pickScoreContext.ts";
import {
  boardScanStagedLegQualifies,
  topUpBoardBuiltTicket,
  type CoachPickEnrichSources,
  type RecommendablePick,
} from "./pickRecommendation.ts";

/** Re-score without dropping a leg that already cleared sim+edge staging. */
export function mergeRescoredCoachPick<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    startsAt?: string | null;
    sport?: string;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(prior: T, next: T): T {
  if (!prior.finalAiScore) return next;
  if (!next.finalAiScore) return prior;
  const priorQualifies = boardScanStagedLegQualifies(prior, prior.finalAiScore);
  const nextQualifies = boardScanStagedLegQualifies(next, next.finalAiScore);
  if (!priorQualifies || nextQualifies) return next;

  const priorHolistic = prior.finalAiScore.propHolistic;
  const nextHolistic = next.finalAiScore.propHolistic;
  const mergedHolistic =
    priorHolistic && nextHolistic
      ? {
          ...nextHolistic,
          factors: nextHolistic.factors.map((f) => {
            const pf = priorHolistic.factors.find((x) => x.key === f.key);
            if (!f.present && pf?.present) return pf;
            return f;
          }),
          composite: nextHolistic.composite ?? priorHolistic.composite,
          grade: nextHolistic.grade ?? priorHolistic.grade,
          confidencePct: nextHolistic.confidencePct ?? priorHolistic.confidencePct,
          recommends: priorHolistic.recommends || nextHolistic.recommends,
        }
      : (nextHolistic ?? priorHolistic);

  return {
    ...next,
    finalAiScore: {
      ...next.finalAiScore,
      simHit: next.finalAiScore.simHit ?? prior.finalAiScore.simHit,
      edgePct: next.finalAiScore.edgePct ?? prior.finalAiScore.edgePct,
      composite: Math.max(
        next.finalAiScore.composite ?? 0,
        prior.finalAiScore.composite ?? 0,
      ),
      grade: next.finalAiScore.grade ?? prior.finalAiScore.grade,
      confidencePct:
        next.finalAiScore.confidencePct ?? prior.finalAiScore.confidencePct,
      recommends: prior.finalAiScore.recommends || next.finalAiScore.recommends,
      propHolistic: mergedHolistic,
      rubric: next.finalAiScore.rubric ?? prior.finalAiScore.rubric,
    },
  };
}

/** Re-attach scores but keep staged legs when holistic rescoring gets stricter. */
export function rescoreCoachTicketPreservingLegs(
  picks: ParsedPick[],
  enrich: CoachFlashEnrich,
): ParsedPick[] {
  if (!picks.length) return picks;
  const rescored = rescoreCoachTicketPicks(picks, enrich);
  return rescored.map((next, i) => mergeRescoredCoachPick(picks[i]!, next));
}

/** Top up a fixed-leg ticket from the board-scan pool when delivery is short. */
export function topUpCoachTicketToTarget<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    startsAt?: string | null;
    sport?: string;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(current: T[], target: number, pool: T[], enrich?: CoachPickEnrichSources): T[] {
  if (target <= 0 || current.length >= target || !pool.length) {
    return target > 0 ? current.slice(0, target) : current;
  }
  return topUpBoardBuiltTicket(current, target, pool, enrich);
}

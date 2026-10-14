import type { CoachPickDisplay, CoachQualifiedLeg } from "@workspace/coach-types";
import type { CoachRankedLeg } from "@workspace/coach-rank";

export function toPickDisplay(leg: CoachQualifiedLeg | CoachRankedLeg): CoachPickDisplay {
  return {
    game: leg.gameLabel,
    market: leg.marketLabel,
    pick: leg.pick,
    odds: leg.odds,
    sport: leg.sport,
    isProp: leg.kind === "player_prop",
    startsAt: leg.startsAt,
    player: leg.playerName ?? null,
    propLine: leg.line,
    propSide: leg.propSide ?? null,
    propIsAlt: leg.isAlt,
    edgePct: leg.edgePct,
    evPct: leg.evPct,
    simHitPct: leg.simHitPct,
    confidencePct:
      "effectiveConfidencePct" in leg && leg.effectiveConfidencePct != null
        ? leg.effectiveConfidencePct
        : leg.confidencePct,
    grade: leg.grade,
    compositeScore: leg.compositeScore,
  };
}

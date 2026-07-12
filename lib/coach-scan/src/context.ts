import type { CoachCandidateLeg, CoachSportContext } from "@workspace/coach-types";
import type { CoachGateEvaluationContext } from "@workspace/coach-gates";

/** Resolves per-candidate gate slices from the sport feed context. */
export type CoachGateContextResolver = (
  candidate: CoachCandidateLeg,
  sportContext: CoachSportContext,
) => CoachGateEvaluationContext;

/**
 * Default resolver — expects structured slices already normalized on sportContext.
 * Api-server / coach-data will replace this with feed-aware builders in a later phase.
 */
export function passthroughGateContextResolver(
  candidate: CoachCandidateLeg,
  sportContext: CoachSportContext,
): CoachGateEvaluationContext {
  const gameKey = candidate.gameLabel;
  const matchupRaw = sportContext.matchupHistory[gameKey] as
    | { mlLean?: { side: string; edge: number } }
    | undefined;
  const trendsRaw = sportContext.trends[candidate.legId] as
    | { momentum?: number; sampleSize?: number }
    | undefined;
  const injuriesRaw = sportContext.injuries[candidate.gameId] as
    | { favor?: number }
    | undefined;
  const lineRaw = sportContext.lineMovement[candidate.legFingerprint] as
    | { direction?: "toward" | "against" | "neutral"; magnitudePct?: number }
    | undefined;

  return {
    matchup: matchupRaw
      ? {
          mlLean: matchupRaw.mlLean ?? null,
          pickTeam: candidate.kind === "game_line" ? candidate.pick.replace(/\s*(ml|moneyline)\s*$/i, "").replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "").trim() : null,
        }
      : undefined,
    trends: trendsRaw
      ? { momentum: trendsRaw.momentum, sampleSize: trendsRaw.sampleSize }
      : undefined,
    injuries: injuriesRaw ? { favor: injuriesRaw.favor } : undefined,
    lineMovement: lineRaw
      ? { direction: lineRaw.direction, magnitudePct: lineRaw.magnitudePct }
      : undefined,
  };
}

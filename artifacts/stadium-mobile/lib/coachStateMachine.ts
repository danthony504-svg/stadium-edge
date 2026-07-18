// Strict forward-only Coach build phase machine.

export const COACH_BUILD_PHASES = [
  "idle",
  "loading-markets",
  "analyzing",
  "calculating-value",
  "simulating",
  "correlating",
  "finalizing",
  "completed",
  "failed",
] as const;

export type CoachBuildPhase = (typeof COACH_BUILD_PHASES)[number];

const PHASE_ORDER: Record<CoachBuildPhase, number> = {
  idle: 0,
  "loading-markets": 1,
  analyzing: 2,
  "calculating-value": 3,
  simulating: 4,
  correlating: 5,
  finalizing: 6,
  completed: 7,
  failed: 7,
};

export function canAdvanceCoachPhase(
  from: CoachBuildPhase,
  to: CoachBuildPhase,
  newRequest: boolean,
): boolean {
  if (newRequest) return to === "loading-markets" || to === "analyzing";
  if (from === to) return true;
  if (from === "completed" || from === "failed") return to === "idle";
  if (to === "failed") return from !== "idle";
  if (to === "idle") return false;
  return PHASE_ORDER[to] >= PHASE_ORDER[from];
}

export function nextCoachPhase(
  current: CoachBuildPhase,
  target: CoachBuildPhase,
  newRequest: boolean,
): CoachBuildPhase {
  if (current === target) return current;
  if (!canAdvanceCoachPhase(current, target, newRequest)) return current;
  return target;
}

/** Map strict machine phase to legacy AnalysisProgress buildPhase prop. */
export function coachPhaseToProgressBuildPhase(
  phase: CoachBuildPhase,
): "context" | "board-scan" | "stream" | "score" | undefined {
  switch (phase) {
    case "idle":
    case "completed":
    case "failed":
      return undefined;
    case "loading-markets":
    case "analyzing":
      return "context";
    case "simulating":
    case "calculating-value":
      return "stream";
    case "correlating":
    case "finalizing":
      return "board-scan";
    default:
      return "score";
  }
}

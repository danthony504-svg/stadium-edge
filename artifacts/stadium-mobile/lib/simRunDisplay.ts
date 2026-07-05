// Simulator run metadata from the API — display labels and debug readout.
import type { SimRunStats } from "./api";

export const REQUESTED_DEEP_SIMS = 10_000;

export function formatSimCountLabel(
  run: SimRunStats | null | undefined,
  requested = REQUESTED_DEEP_SIMS,
): string {
  if (!run) return "—";
  const completed = run.completedSims ?? run.actualSimCount ?? run.simulations ?? 0;
  const req = run.requestedSims ?? requested;
  if (completed >= req && completed === REQUESTED_DEEP_SIMS) {
    return `${completed.toLocaleString()} Sims`;
  }
  if (completed > 0) {
    return `${completed.toLocaleString()} Sims · partial simulation`;
  }
  return "No sims completed";
}

export function isFullDeepSimulation(
  run: SimRunStats | null | undefined,
  requested = REQUESTED_DEEP_SIMS,
): boolean {
  if (!run) return false;
  const completed = run.completedSims ?? run.actualSimCount ?? 0;
  const req = run.requestedSims ?? requested;
  return completed >= req && completed === REQUESTED_DEEP_SIMS && (run.failedSims ?? 0) === 0;
}

export function mergeSimRuns(
  game?: SimRunStats | null,
  props?: SimRunStats | null,
): SimRunStats | null {
  if (game && props) {
    const completedSims = Math.min(game.completedSims, props.completedSims);
    return {
      requestedSims: Math.max(game.requestedSims, props.requestedSims),
      completedSims,
      failedSims: game.failedSims + props.failedSims,
      actualSimCount: completedSims,
      startedAt: game.startedAt < props.startedAt ? game.startedAt : props.startedAt,
      finishedAt: game.finishedAt > props.finishedAt ? game.finishedAt : props.finishedAt,
      runTimeMs: game.runTimeMs + props.runTimeMs,
      sampleGames: props.sampleGames ?? game.sampleGames,
    };
  }
  return game ?? props ?? null;
}

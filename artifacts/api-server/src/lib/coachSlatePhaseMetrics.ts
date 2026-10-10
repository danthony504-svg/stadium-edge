import { logger } from "./logger.js";

export type CoachSlatePhaseName =
  | "lock"
  | "prebuild"
  | "context_build"
  | "prop_sims_enrich"
  | "board_scan"
  | "persist_final"
  | "total";

export function rssMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;
}

export function heapUsedMb(): number {
  return Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10;
}

export function logCoachSlatePhase(
  phase: CoachSlatePhaseName,
  startedAt: number,
  extra?: Record<string, unknown>,
): { phase: string; durationMs: number; rssMb: number; heapUsedMb: number } {
  const payload = {
    phase,
    durationMs: Date.now() - startedAt,
    rssMb: rssMb(),
    heapUsedMb: heapUsedMb(),
    ...extra,
  };
  logger.info(payload, "coach slate phase");
  return payload;
}

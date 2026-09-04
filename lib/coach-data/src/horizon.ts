import { COACH_HORIZON_MS } from "@workspace/coach-types";

import type { CoachHorizonFilterResult } from "./types";

const FINAL_STATUSES = new Set([
  "final",
  "completed",
  "closed",
  "post",
  "status_final",
]);

const IN_PROGRESS_STATUSES = new Set([
  "in",
  "in_progress",
  "live",
  "halftime",
  "status_in_progress",
]);

export function parseStartsAtMs(startsAt: string | null | undefined): number | null {
  if (!startsAt) return null;
  const ms = Date.parse(startsAt);
  return Number.isFinite(ms) ? ms : null;
}

export function isPregameStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  const s = status.toLowerCase().trim();
  if (FINAL_STATUSES.has(s)) return false;
  if (IN_PROGRESS_STATUSES.has(s)) return false;
  return true;
}

/** True when kickoff is in the future and within the 48h coach horizon. */
export function isWithinCoachHorizon(
  startsAt: string | null | undefined,
  nowMs = Date.now(),
  horizonMs = COACH_HORIZON_MS,
): boolean {
  const kickoff = parseStartsAtMs(startsAt);
  if (kickoff == null) return false;
  const delta = kickoff - nowMs;
  return delta > 0 && delta <= horizonMs;
}

export function filterByCoachHorizon<T extends { startsAt?: string | null }>(
  items: T[],
  nowMs = Date.now(),
  horizonMs = COACH_HORIZON_MS,
): CoachHorizonFilterResult<T> {
  const kept: T[] = [];
  let dropped = 0;
  for (const item of items) {
    if (isWithinCoachHorizon(item.startsAt, nowMs, horizonMs)) {
      kept.push(item);
    } else {
      dropped += 1;
    }
  }
  return { kept, dropped };
}

export function filterPregameGames<T extends { status?: string | null; startsAt?: string | null }>(
  games: T[],
  nowMs = Date.now(),
  horizonMs = COACH_HORIZON_MS,
): CoachHorizonFilterResult<T> {
  const kept: T[] = [];
  let dropped = 0;
  for (const game of games) {
    if (!isPregameStatus(game.status)) {
      dropped += 1;
      continue;
    }
    if (!isWithinCoachHorizon(game.startsAt, nowMs, horizonMs)) {
      dropped += 1;
      continue;
    }
    kept.push(game);
  }
  return { kept, dropped };
}

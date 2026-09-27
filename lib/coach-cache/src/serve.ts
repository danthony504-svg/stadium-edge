import {
  COACH_SNAPSHOT_MAX_AGE_MS,
  type CoachSnapshot,
  type CoachV2SlateResponse,
} from "@workspace/coach-types";

import { evaluateSnapshotFreshness } from "./freshness";

export type BuildCoachV2SlateResponseInput = {
  snapshot: CoachSnapshot | null;
  nowMs?: number;
  refreshing?: boolean;
  maxAgeMs?: number;
};

export function buildCoachV2SlateResponse(
  input: BuildCoachV2SlateResponseInput,
): CoachV2SlateResponse {
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? COACH_SNAPSHOT_MAX_AGE_MS;
  const refreshing = input.refreshing ?? false;

  if (!input.snapshot) {
    return {
      snapshot: null,
      fresh: false,
      instantServe: false,
      refreshing,
      computedAt: null,
      deepSimComplete: false,
      maxAgeMs,
      activeSports: [],
    };
  }

  const freshness = evaluateSnapshotFreshness(input.snapshot, nowMs, maxAgeMs);

  return {
    snapshot: input.snapshot,
    fresh: freshness.fresh,
    instantServe: freshness.instantServe,
    refreshing,
    computedAt: new Date(input.snapshot.at).toISOString(),
    deepSimComplete: input.snapshot.deepSimComplete,
    maxAgeMs,
    activeSports: input.snapshot.activeSports.map(String),
  };
}

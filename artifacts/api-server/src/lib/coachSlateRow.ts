/**
 * Pure helpers for coach_precomputed_slate row shaping.
 * Kept DB-free so unit tests can cover production failure modes
 * (string/null updatedAt, non-object data) without DATABASE_URL.
 */

import {
  type SlatePreAnalysisSnapshot,
  isSlateSnapshotFresh,
  isSlateSnapshotInstantServe,
} from "./coachSlateTypes.js";

export type { SlatePreAnalysisSnapshot };

function timestampToIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

/** Normalize a DB row into the store result shape — pure, never throws. */
export function normalizeCoachPrecomputedSlateRow(row: {
  data?: unknown;
  updatedAt?: unknown;
  deepSimComplete?: unknown;
} | null | undefined): {
  snapshot: SlatePreAnalysisSnapshot | null;
  fresh: boolean;
  instantServe: boolean;
  computedAt: string | null;
  deepSimComplete: boolean;
} {
  if (!row) {
    return {
      snapshot: null,
      fresh: false,
      instantServe: false,
      computedAt: null,
      deepSimComplete: false,
    };
  }
  const snapshot =
    row.data && typeof row.data === "object"
      ? (row.data as SlatePreAnalysisSnapshot)
      : null;
  return {
    snapshot,
    fresh: isSlateSnapshotFresh(snapshot),
    instantServe: isSlateSnapshotInstantServe(snapshot),
    computedAt: timestampToIso(row.updatedAt),
    deepSimComplete: row.deepSimComplete === true,
  };
}

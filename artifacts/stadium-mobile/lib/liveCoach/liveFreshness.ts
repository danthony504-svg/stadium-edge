/**
 * Live price freshness metadata (Phase 1).
 * Classifies fresh | stale | unknown — does NOT set recommendation thresholds.
 */

import type { LiveFreshnessStatus } from "./types.ts";

/** Default: quotes older than 45s are classified stale (metadata only). */
export const LIVE_PRICE_STALE_AFTER_MS = 45_000;

export type FreshnessResult = {
  status: LiveFreshnessStatus;
  ageMs: number | null;
  /** Which clock was used for age: provider | fetchedAt | none */
  ageSource: "providerLastUpdate" | "fetchedAt" | "none";
};

/**
 * Classify live price freshness.
 *
 * - Prefer genuine providerLastUpdate when present.
 * - Else use fetchedAt (server assembly time).
 * - If neither is a valid timestamp → unknown (never silently treated as fresh).
 */
export function classifyLivePriceFreshness(
  opts: {
    providerLastUpdate?: string | null;
    fetchedAt?: string | null;
    nowMs?: number;
    staleAfterMs?: number;
  },
): FreshnessResult {
  const now = opts.nowMs ?? Date.now();
  const staleAfter = opts.staleAfterMs ?? LIVE_PRICE_STALE_AFTER_MS;

  const providerMs = parseTs(opts.providerLastUpdate);
  if (providerMs != null) {
    const ageMs = Math.max(0, now - providerMs);
    return {
      status: ageMs > staleAfter ? "stale" : "fresh",
      ageMs,
      ageSource: "providerLastUpdate",
    };
  }

  const fetchedMs = parseTs(opts.fetchedAt);
  if (fetchedMs != null) {
    const ageMs = Math.max(0, now - fetchedMs);
    return {
      status: ageMs > staleAfter ? "stale" : "fresh",
      ageMs,
      ageSource: "fetchedAt",
    };
  }

  return { status: "unknown", ageMs: null, ageSource: "none" };
}

function parseTs(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

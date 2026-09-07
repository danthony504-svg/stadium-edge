import { createHash } from "node:crypto";

export const PERFORMANCE_SOURCES = ["coach", "build_best_parlay", "hot_picks", "easy_money", "best_value", "longshots"] as const;
export type PerformanceSource = (typeof PERFORMANCE_SOURCES)[number];

export type RecommendationInput = {
  source: PerformanceSource;
  sport: string;
  game: string;
  market: string;
  selection: string;
  line?: string | null;
  odds: number;
  startsAt?: string | null;
  providerEventId: string;
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Stable per-user identity. The event id prevents series games from colliding. */
export function recommendationIdentity(input: RecommendationInput): string {
  return [
    input.source,
    input.sport,
    input.providerEventId,
    input.market,
    input.selection,
    input.line ?? "",
  ].map(normalize).join("|");
}

export function recommendationId(userId: string, input: RecommendationInput): string {
  return createHash("sha256").update(`${userId}|${recommendationIdentity(input)}`).digest("hex");
}

/** Today's Performance uses the UTC calendar day, consistently on API and clients. */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isPerformanceSource(value: unknown): value is PerformanceSource {
  return typeof value === "string" && (PERFORMANCE_SOURCES as readonly string[]).includes(value);
}

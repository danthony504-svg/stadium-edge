import type { CoachSnapshot } from "./ticket";
import type { CoachScanStatus } from "./scan";
import type { CoachTicketResponse } from "./ticket";

export type CoachV2SlateResponse = {
  snapshot: CoachSnapshot | null;
  fresh: boolean;
  instantServe: boolean;
  refreshing: boolean;
  computedAt: string | null;
  deepSimComplete: boolean;
  maxAgeMs: number;
  activeSports: string[];
};

export type CoachV2TicketQuery = {
  legs: number;
  sport?: string | null;
};

export type CoachV2TicketResponse = CoachTicketResponse;

export type CoachV2ScanStatusResponse = CoachScanStatus;

export type CoachV2LearningSummary = {
  version: number;
  updatedAt: string;
  buckets: Array<{
    sport: string;
    marketKey: string;
    sampleSize: number;
    winRate: number;
    confidenceAdjustment: number;
    rankWeightMultiplier: number;
  }>;
};

export type CoachV2LearningResponse = {
  summary: CoachV2LearningSummary;
};

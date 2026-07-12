import type { CoachSportIdOrCustom } from "./sports";
import type { CoachGateReasonCode } from "./gates";
import type { CoachQualifiedLeg } from "./candidates";

export type CoachScanPhase =
  | "idle"
  | "warming_caches"
  | "enumerating_markets"
  | "simulating"
  | "gating"
  | "ranking"
  | "assembling_tickets"
  | "complete"
  | "failed";

export type CoachScanManifest = {
  contextFingerprint: string;
  scanStartedAt: string;
  scanCompletedAt: string | null;
  phase: CoachScanPhase;
  sports: CoachSportIdOrCustom[];
  /** Posted vs seen must match when scanComplete is true. */
  marketsPosted: number;
  marketsSeen: number;
  propsPosted: number;
  propsSeen: number;
  gameLinesPosted: number;
  gameLinesSeen: number;
  altLinesPosted: number;
  altLinesSeen: number;
  candidatesEvaluated: number;
  simCacheHits: number;
  simCacheMisses: number;
  deepSimComplete: boolean;
  scanComplete: boolean;
  gatesPassed: number;
  gatesRejected: number;
  rejectionBreakdown: Partial<Record<CoachGateReasonCode, number>>;
};

export type CoachQualifiedLegPool = {
  manifest: CoachScanManifest;
  props: CoachQualifiedLeg[];
  gameLines: CoachQualifiedLeg[];
};

export type CoachScanStatus = {
  jobRunning: boolean;
  manifest: CoachScanManifest | null;
  lastError: string | null;
  updatedAt: string;
};

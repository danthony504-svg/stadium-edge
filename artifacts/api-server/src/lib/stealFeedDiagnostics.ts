/** Structured odds-feed diagnostics for +500 Steals — surfaced to mobile clients. */

import type { LiveStealsStageRecord } from "./liveStealsPipelineTrace.ts";

export type StealOddsSportProbe = {
  sport: string;
  endpoint: string;
  ok: boolean;
  httpStatus: number;
  responseTimeMs: number;
  games: number;
  error?: string;
};

export type StealFeedDiagnostics = {
  provider: "the-odds-api";
  scanEndpoint: "/api/sports/live-steals";
  responseTimeMs: number;
  oddsKeyConfigured: boolean;
  sportsProbed: number;
  sportsOk: number;
  sportsFailed: number;
  sportProbes: StealOddsSportProbe[];
  errorReason: string | null;
  /** Per-stage scan log — exact failure point when scan degrades. */
  scanStages?: LiveStealsStageRecord[];
  failedStage?: string | null;
};

export class StealFeedScanError extends Error {
  readonly diagnostics: StealFeedDiagnostics;
  readonly failedStage?: string | null;

  constructor(
    message: string,
    diagnostics: StealFeedDiagnostics,
    opts?: { failedStage?: string | null; cause?: unknown },
  ) {
    super(message, opts?.cause != null ? { cause: opts.cause } : undefined);
    this.name = "StealFeedScanError";
    this.diagnostics = diagnostics;
    this.failedStage = opts?.failedStage ?? diagnostics.failedStage ?? null;
  }
}

export function emptyStealFeedDiagnostics(
  partial: Partial<StealFeedDiagnostics> = {},
): StealFeedDiagnostics {
  return {
    provider: "the-odds-api",
    scanEndpoint: "/api/sports/live-steals",
    responseTimeMs: 0,
    oddsKeyConfigured: Boolean(process.env["ODDS_API_KEY"]),
    sportsProbed: 0,
    sportsOk: 0,
    sportsFailed: 0,
    sportProbes: [],
    errorReason: null,
    ...partial,
  };
}

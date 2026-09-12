import type { SlateParlayLegCount, SlatePreAnalysisSnapshot } from "./slatePreAnalysisCache.ts";

export type CoachServerSlateResponse = {
  snapshot: SlatePreAnalysisSnapshot | null;
  fresh: boolean;
  instantServe: boolean;
  refreshing?: boolean;
  computedAt: string | null;
  deepSimComplete: boolean;
  maxAgeMs: number;
  instantServeMaxMs?: number;
  supportedLegCounts?: SlateParlayLegCount[];
  resolvedLegCount?: number;
  resolvedSport?: string;
  activeSports?: string[];
};

export type CoachSlateFetchOpts = {
  legs?: number;
  sport?: string | null;
  signal?: AbortSignal;
};

/**
 * Server precomputed slate fetch — stubbed in greenfield Coach rebuild.
 * The new Coach builds via live board scan; slate warm-cache can return later.
 */
export async function fetchCoachServerSlate(
  _opts?: CoachSlateFetchOpts,
): Promise<CoachServerSlateResponse | null> {
  return null;
}

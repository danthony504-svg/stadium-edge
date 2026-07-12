import { getJson } from "./api.ts";
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

/** Fetch the latest server-precomputed Coach slate (24/7 background job). */
export async function fetchCoachServerSlate(
  opts?: CoachSlateFetchOpts,
): Promise<CoachServerSlateResponse | null> {
  try {
    const params = new URLSearchParams();
    if (opts?.legs != null && opts.legs >= 3) params.set("legs", String(opts.legs));
    if (opts?.sport) params.set("sport", opts.sport);
    const qs = params.toString();
    const path = qs ? `/coach/slate?${qs}` : "/coach/slate";
    return await getJson<CoachServerSlateResponse>(path, opts?.signal, 12_000);
  } catch {
    return null;
  }
}

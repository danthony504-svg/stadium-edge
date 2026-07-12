import { getJson } from "./api.ts";
import type { SlatePreAnalysisSnapshot } from "./slatePreAnalysisCache.ts";

export type CoachServerSlateResponse = {
  snapshot: SlatePreAnalysisSnapshot | null;
  fresh: boolean;
  computedAt: string | null;
  deepSimComplete: boolean;
  maxAgeMs: number;
};

/** Fetch the latest server-precomputed Coach slate (24/7 background job). */
export async function fetchCoachServerSlate(signal?: AbortSignal): Promise<CoachServerSlateResponse | null> {
  try {
    return await getJson<CoachServerSlateResponse>("/coach/slate", signal, 12_000);
  } catch {
    return null;
  }
}

import type { SlateParlayLegCount, SlatePreAnalysisSnapshot } from "./slatePreAnalysisCache.ts";
import { fetchCoachV2Slate } from "./coachV2Api.ts";
import { coachV2SnapshotToLegacy } from "./coachV2Adapter.ts";
import type { CoachV2SlateResponse } from "./coachV2Types.ts";

export type CoachServerSlateResponse = CoachV2SlateResponse & {
  instantServeMaxMs?: number;
  supportedLegCounts?: SlateParlayLegCount[];
  resolvedLegCount?: number;
  resolvedSport?: string;
};

export type CoachSlateFetchOpts = {
  legs?: number;
  sport?: string | null;
  signal?: AbortSignal;
};

/** Fetch the latest server-precomputed Coach v2 slate. */
export async function fetchCoachServerSlate(
  opts?: CoachSlateFetchOpts,
): Promise<CoachServerSlateResponse | null> {
  const resp = await fetchCoachV2Slate(opts);
  if (!resp) return null;
  return resp;
}

/** Convert v2 API snapshot to legacy cache format. */
export function legacySnapshotFromServerResponse(
  snapshot: CoachServerSlateResponse["snapshot"],
): SlatePreAnalysisSnapshot | null {
  if (!snapshot) return null;
  return coachV2SnapshotToLegacy(snapshot);
}

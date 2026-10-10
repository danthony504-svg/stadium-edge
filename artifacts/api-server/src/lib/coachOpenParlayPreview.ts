/**
 * Locked open-parlay preview for free / logged-out POST /chat callers.
 * Never includes player/team/selection/line/odds identity — only count + grades.
 */

import { resolveBuildLegTarget } from "./coachAskAccess.js";
import {
  buildLockedPreviewFromSlateRow,
  emptyLockedPreview,
} from "./coachOpenParlayPreviewCore.js";
import { getCoachPrecomputedSlate } from "./coachSlateStore.js";
import { logger } from "./logger.js";
import { nearestSlateParlaySize } from "./coachSlateTypes.js";

export {
  assertLockedPreviewSafe,
  buildLockedPreviewFromSlateRow,
  COACH_LOCKED_PARLAY_CTA,
  emptyLockedPreview,
  type LockedOpenParlayPreview,
} from "./coachOpenParlayPreviewCore.js";

/** Build a safe preview from the precomputed slate (already redacted). */
export async function buildLockedOpenParlayPreview(opts: {
  askText: string;
}): Promise<import("./coachOpenParlayPreviewCore.js").LockedOpenParlayPreview> {
  const requestedLegs = resolveBuildLegTarget(opts.askText) || 6;
  const size = nearestSlateParlaySize(requestedLegs);
  try {
    const row = await getCoachPrecomputedSlate();
    return buildLockedPreviewFromSlateRow(opts.askText, row);
  } catch (err) {
    logger.error({ err }, "locked open-parlay preview failed; serving empty lock");
    return emptyLockedPreview(size);
  }
}

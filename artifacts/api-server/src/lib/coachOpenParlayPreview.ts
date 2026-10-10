/**
 * Locked open-parlay preview for free / logged-out POST /chat callers.
 * Never includes player/team/selection/line/odds identity — only count + grades.
 */

import { COACH_QA_SUBSCRIBE_MESSAGE, resolveBuildLegTarget } from "./coachAskAccess.js";
import {
  assertLockedPreviewSafe,
  COACH_LOCKED_PARLAY_CTA,
  type LockedOpenParlayPreview,
} from "./coachLockedPreviewSafety.js";
import { getCoachPrecomputedSlate } from "./coachSlateStore.js";
import {
  nearestSlateParlaySize,
  redactPremiumPickForClient,
  resolveSlateBoardScan,
  snapshotForClient,
  type ParsedPick,
} from "./coachSlateTypes.js";

export {
  assertLockedPreviewSafe,
  COACH_LOCKED_PARLAY_CTA,
  type LockedOpenParlayPreview,
} from "./coachLockedPreviewSafety.js";

/** Build a safe preview from the precomputed slate (already redacted). */
export async function buildLockedOpenParlayPreview(opts: {
  askText: string;
}): Promise<LockedOpenParlayPreview> {
  const requestedLegs = resolveBuildLegTarget(opts.askText) || 6;
  const size = nearestSlateParlaySize(requestedLegs);
  const row = await getCoachPrecomputedSlate();
  const hasUsable = !!(row.snapshot && (row.fresh || row.instantServe));
  let picks: ParsedPick[] = [];
  if (hasUsable && row.snapshot) {
    const client = snapshotForClient(row.snapshot, {
      legs: size,
      premiumUnlocked: false,
    });
    const fromClient = client.boardScan?.picks ?? [];
    if (fromClient.length > 0) {
      picks = fromClient.map((p) => redactPremiumPickForClient(p));
    } else {
      const scan = resolveSlateBoardScan(row.snapshot, { legs: size });
      picks = (scan?.picks ?? []).map((p) => redactPremiumPickForClient(p));
    }
  }

  const pickCount = picks.length;
  const content =
    pickCount > 0
      ? `${pickCount} qualifying pick${pickCount === 1 ? "" : "s"} ready for a ${size}-leg parlay. AI Grade, Confidence, and Edge are shown when available — ${COACH_LOCKED_PARLAY_CTA.toLowerCase()} for teams, players, lines, and odds.`
      : `Parlay preview is locked. ${COACH_QA_SUBSCRIBE_MESSAGE} You can still open AI Coach in the app to build 1–15-leg parlays with blurred pick cards.`;

  return {
    content,
    pickCount,
    requestedLegs: size,
    picks,
    cta: COACH_LOCKED_PARLAY_CTA,
  };
}

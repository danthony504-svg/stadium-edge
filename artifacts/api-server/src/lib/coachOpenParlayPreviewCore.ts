/**
 * Pure locked open-parlay preview helpers (no DB).
 */

import { COACH_QA_SUBSCRIBE_MESSAGE, resolveBuildLegTarget } from "./coachAskAccess.js";
import {
  assertLockedPreviewSafe,
  COACH_LOCKED_PARLAY_CTA,
  type LockedOpenParlayPreview,
} from "./coachLockedPreviewSafety.js";
import {
  nearestSlateParlaySize,
  redactPremiumPickForClient,
  resolveSlateBoardScan,
  snapshotForClient,
  type ParsedPick,
  type SlatePreAnalysisSnapshot,
} from "./coachSlateTypes.js";

export {
  assertLockedPreviewSafe,
  COACH_LOCKED_PARLAY_CTA,
  type LockedOpenParlayPreview,
} from "./coachLockedPreviewSafety.js";

export function emptyLockedPreview(size: number): LockedOpenParlayPreview {
  return {
    content: `Parlay preview is locked. ${COACH_QA_SUBSCRIBE_MESSAGE} You can still open AI Coach in the app to build 1–15-leg parlays with blurred pick cards.`,
    pickCount: 0,
    requestedLegs: size,
    picks: [],
    cta: COACH_LOCKED_PARLAY_CTA,
  };
}

type SlateRow = {
  snapshot: SlatePreAnalysisSnapshot | null;
  fresh: boolean;
  instantServe: boolean;
};

/**
 * Pure locked-preview builder from an already-loaded slate row.
 * Never throws; never returns identity-bearing picks.
 */
export function buildLockedPreviewFromSlateRow(
  askText: string,
  row: SlateRow,
): LockedOpenParlayPreview {
  const requestedLegs = resolveBuildLegTarget(askText) || 6;
  const size = nearestSlateParlaySize(requestedLegs);
  try {
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

    const preview: LockedOpenParlayPreview = {
      content,
      pickCount,
      requestedLegs: size,
      picks,
      cta: COACH_LOCKED_PARLAY_CTA,
    };
    if (assertLockedPreviewSafe(preview).length > 0) {
      return emptyLockedPreview(size);
    }
    return preview;
  } catch {
    return emptyLockedPreview(size);
  }
}

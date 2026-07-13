import type { CoachScanManifest, CoachShortfallReason } from "@workspace/coach-types";

export function topRejectionReasons(
  manifest: CoachScanManifest,
  limit = 2,
): Array<{ reason: string; count: number }> {
  const entries = Object.entries(manifest.rejectionBreakdown)
    .map(([reason, count]) => ({ reason, count: count ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  return entries.slice(0, limit);
}

export function buildShortfallReason(
  manifest: CoachScanManifest,
  requestedLegs: number,
  deliveredLegs: number,
  propsQualified: number,
  gameLinesQualified: number,
): CoachShortfallReason {
  const scanned = manifest.propsPosted + manifest.gameLinesPosted;
  const passed = manifest.gatesPassed;
  return {
    code: "insufficient_qualified_legs",
    message: `Only ${deliveredLegs} legs passed all AI gates in the 48h window. ${scanned} lines scanned, ${passed} passed gates. No filler picks added.`,
    requestedLegs,
    deliveredLegs,
    propsQualified,
    gameLinesQualified,
    topRejections: topRejectionReasons(manifest),
  };
}

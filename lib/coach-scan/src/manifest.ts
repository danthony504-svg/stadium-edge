import type { CoachScanManifest } from "@workspace/coach-types";

import type { CoachNormalizedSlate } from "@workspace/coach-data";

export type SlateInventoryCounts = Pick<
  CoachScanManifest,
  | "marketsPosted"
  | "marketsSeen"
  | "propsPosted"
  | "propsSeen"
  | "gameLinesPosted"
  | "gameLinesSeen"
  | "altLinesPosted"
  | "altLinesSeen"
>;

export function countSlateInventory(slate: CoachNormalizedSlate): SlateInventoryCounts {
  const props = slate.props;
  const gameLines = slate.gameLines;
  const altLines = [...props, ...gameLines].filter((row) => row.isAlt);
  const marketKeys = new Set<string>();
  for (const row of props) marketKeys.add(`${row.sport}:${row.marketKey}`);
  for (const row of gameLines) marketKeys.add(`${row.sport}:${row.marketKey}`);

  const counts: SlateInventoryCounts = {
    propsPosted: props.length,
    propsSeen: props.length,
    gameLinesPosted: gameLines.length,
    gameLinesSeen: gameLines.length,
    altLinesPosted: altLines.length,
    altLinesSeen: altLines.length,
    marketsPosted: marketKeys.size,
    marketsSeen: marketKeys.size,
  };
  return counts;
}

export function createScanManifestBase(
  slate: CoachNormalizedSlate,
  sports: string[],
  startedAt: string,
): CoachScanManifest {
  return {
    contextFingerprint: slate.contextFingerprint,
    scanStartedAt: startedAt,
    scanCompletedAt: null,
    phase: "enumerating_markets",
    sports,
    ...countSlateInventory(slate),
    candidatesEvaluated: 0,
    simCacheHits: 0,
    simCacheMisses: 0,
    deepSimComplete: false,
    scanComplete: false,
    gatesPassed: 0,
    gatesRejected: 0,
    rejectionBreakdown: {},
  };
}

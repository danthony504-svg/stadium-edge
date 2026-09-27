import type { CoachQualifiedLeg } from "@workspace/coach-types";

import type { CoachAltTierLabel } from "./types";
import { MAX_ALT_LADDER_DISPLAY_RUNGS } from "./types";

/** Lowest posted line = Safest; highest = High Risk (Over and Under). */
export function ladderTierForSiblingIndex(i: number, n: number): CoachAltTierLabel {
  if (n <= 1) return "Best";
  if (i === 0) return "Safest";
  if (i === n - 1) return "High Risk";
  if (i === Math.floor(n / 2)) return "Best Value";
  return "Best";
}

export function championDisplayIndices(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const indices = new Set<number>([0, n - 1, Math.floor(n / 2)]);
  let bestIdx = Math.max(1, Math.min(n - 2, Math.floor(n * 0.25)));
  while (indices.has(bestIdx) && bestIdx < n - 1) bestIdx += 1;
  if (!indices.has(bestIdx)) indices.add(bestIdx);
  return [...indices].sort((a, b) => a - b).slice(0, MAX_ALT_LADDER_DISPLAY_RUNGS);
}

/** Sort key where lower = safer rung (easier cushion). */
export function safetySortKey(leg: CoachQualifiedLeg): number {
  const line = leg.line;
  if (line == null || !Number.isFinite(line)) return 0;
  const isUnder =
    leg.propSide === "Under" || /\bunder\b/i.test(leg.pick);
  return isUnder ? -line : line;
}

export function compareRungSafety(a: CoachQualifiedLeg, b: CoachQualifiedLeg): number {
  return safetySortKey(a) - safetySortKey(b);
}

const MAIN_GAME_MARKETS = new Set(["h2h", "spreads", "totals"]);

export function isMainRung(leg: CoachQualifiedLeg): boolean {
  if (leg.kind === "player_prop") return !leg.isAlt;
  if (leg.isAlt) return false;
  return MAIN_GAME_MARKETS.has(leg.marketKey);
}

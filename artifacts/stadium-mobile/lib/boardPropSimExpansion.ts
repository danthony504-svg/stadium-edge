// Progressive board prop sim — fast-rank all props, expand MC until enough qualify.

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";

export const BOARD_PROP_SIM_BATCH = 21;

/** Props with a posted price and a supported sim model — eligible for board MC. */
export function isRealisticBoardPropCandidate(pick: ParsedPick): boolean {
  if (!pick.isProp) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  if (pick.propLine == null || !Number.isFinite(pick.propLine) || !pick.propSide) return false;
  return marketSupportsSimulation(pick.market ?? "", pick);
}

/** How many scanned legs pass main/alt quality gates for this target. */
export function countQualifiedBoardLegs(scored: BoardScoredLeg[], target: number): number {
  const { breakdown } = buildStagedTicketFromScan(scored, target);
  return breakdown.mainQualified + breakdown.altQualified;
}

/** First prop-sim wave — wide enough to surface early qualifiers quickly. */
export function boardPropSimInitialBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, target * 2);
}

/** Later waves while still short of the leg target. */
export function boardPropSimExpansionBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, Math.min(84, target * 4));
}

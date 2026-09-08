// Coach UI paint planning — pure render regression helpers (no RN imports).

import { gatedCoachDisplayPickCount } from "./coachTicketPaintPolicy.ts";

export type CoachMessagePaintInput = {
  role: string;
  rawPicksCount: number;
  displayPicksCount: number;
  hasScanManifest: boolean;
  hasLegNote: boolean;
  hasCoachDetailNote: boolean;
  parlayBuildIntent: boolean;
  streaming: boolean;
  buildFinishing: boolean;
  waiting: boolean;
  isLastMessage: boolean;
  hideBubble?: boolean;
  contentLen: number;
  parlayBuildHung?: boolean;
  isBuildingParlay?: boolean;
  parlayStillFilling?: boolean;
  parlayStillBuilding?: boolean;
  analyzeWaiting?: boolean;
  askWaiting?: boolean;
  showBubble?: boolean;
  ticketLegTarget?: number;
  scanComplete?: boolean;
  stagedPickCount?: number;
};

export type CoachMessagePaintPlan = {
  showProgress: boolean;
  showTicketHeader: boolean;
  showPickCards: boolean;
  showEmptyState: boolean;
  bodyWouldBeBlank: boolean;
};

/** Pure paint planner — mirrors Coach message JSX (for regression tests). */
export function planCoachMessagePaint(input: CoachMessagePaintInput): CoachMessagePaintPlan {
  const buildIdle = !input.buildFinishing && !input.streaming && !input.waiting;
  const ticketLegTarget = input.ticketLegTarget ?? 0;
  const gatedDisplayCount = gatedCoachDisplayPickCount({
    parlayBuildIntent: input.parlayBuildIntent,
    ticketLegTarget,
    displayPicksCount: input.displayPicksCount,
    rawPicksCount: input.rawPicksCount,
    scanComplete: input.scanComplete ?? buildIdle,
    stagedPickCount: input.stagedPickCount ?? input.rawPicksCount,
  });
  const showTicketPicks = gatedDisplayCount > 0;
  const showCoachEmpty =
    input.role === "assistant" &&
    input.parlayBuildIntent &&
    buildIdle &&
    !showTicketPicks &&
    (input.hasScanManifest || input.hasCoachDetailNote || input.hasLegNote || input.rawPicksCount > 0);
  const showTicketHeader = showTicketPicks || input.hasScanManifest || showCoachEmpty;

  const showProgress =
    input.isLastMessage &&
    !showTicketPicks &&
    (input.askWaiting ||
      input.analyzeWaiting ||
      input.isBuildingParlay ||
      input.parlayStillFilling ||
      (input.parlayStillBuilding && !input.parlayBuildHung));

  const showBubble = !!input.showBubble;
  const showPickCards = showTicketPicks;
  const showEmptyState = showCoachEmpty && !showTicketPicks;

  const bodyWouldBeBlank =
    input.isLastMessage &&
    !showProgress &&
    !showTicketHeader &&
    !showBubble &&
    !input.hideBubble &&
    input.role === "assistant" &&
    !buildIdle &&
    input.parlayBuildIntent;

  return {
    showProgress,
    showTicketHeader,
    showPickCards,
    showEmptyState,
    bodyWouldBeBlank,
  };
}

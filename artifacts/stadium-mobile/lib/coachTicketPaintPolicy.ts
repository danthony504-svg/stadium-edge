// Coach ticket paint policy — when to show pick cards during board scan.

/** True when the ticket may render: leg target met OR full-board scan finished. */
export function shouldPaintCoachBoardTicket(opts: {
  parlayBuildIntent: boolean;
  ticketLegTarget: number;
  stagedPickCount: number;
  scanComplete: boolean;
}): boolean {
  if (!opts.parlayBuildIntent) return true;
  if (opts.ticketLegTarget <= 0) return true;
  if (opts.scanComplete) return true;
  return opts.stagedPickCount >= opts.ticketLegTarget;
}

export type CoachMessagePaintGateInput = {
  parlayBuildIntent: boolean;
  ticketLegTarget: number;
  displayPicksCount: number;
  rawPicksCount: number;
  scanComplete: boolean;
  stagedPickCount: number;
};

/** Picks visible on a Coach message after board-scan paint gating. */
export function gatedCoachDisplayPickCount(input: CoachMessagePaintGateInput): number {
  const staged = Math.max(input.stagedPickCount, input.rawPicksCount, input.displayPicksCount);
  const allow = shouldPaintCoachBoardTicket({
    parlayBuildIntent: input.parlayBuildIntent,
    ticketLegTarget: input.ticketLegTarget,
    stagedPickCount: staged,
    scanComplete: input.scanComplete,
  });
  if (!allow) return 0;
  return input.displayPicksCount;
}

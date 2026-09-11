/**
 * Board-scan budget-race handoff (completion path only).
 *
 * Promise.race(boardScanBudgetMs) can return null while the in-flight scan is
 * still scoring. Partials may already be on screen (boardScanComplete !== true).
 * When the floating scan later settles with scanComplete: true, that result must
 * replace the progress ticket — including growing 4 → 5 for a 5-leg ask.
 *
 * Does not change qualification, simulation, grading, odds, markets, dedupe,
 * correlation, or requested-leg rules — only completion adoption after budget.
 */
import {
  boardScanIsComplete,
  boardScanReadyForDelivery,
  coachTicketShowsScanInProgress,
  preferFinalBoardScanForDelivery,
} from "./coachScanPolicy.ts";

export type BudgetHandoffScan = {
  picks?: { length: number };
  requestedLegs?: number;
  requestId?: string;
  scanComplete?: boolean;
};

export type BoardScanUiSnapshot = {
  requestedLegs: number;
  pickCount: number;
  boardScanComplete: boolean | null;
  buildIdle: boolean;
};

/** Mirror coach.tsx post-Promise.race recovery — completes only; never promotes partials. */
export function resolveScanAfterBudgetRace<T extends BudgetHandoffScan>(
  raceWinner: T | null | undefined,
  latestRef: T | null | undefined,
  legTarget: number,
): T | null {
  if (
    raceWinner &&
    boardScanIsComplete(raceWinner) &&
    boardScanReadyForDelivery(raceWinner, legTarget)
  ) {
    return raceWinner;
  }
  if (
    !raceWinner &&
    boardScanIsComplete(latestRef) &&
    boardScanReadyForDelivery(latestRef!, legTarget)
  ) {
    return latestRef!;
  }
  if (!raceWinner?.picks?.length && latestRef?.picks?.length) {
    if (boardScanReadyForDelivery(latestRef, legTarget)) return latestRef!;
  }
  return preferFinalBoardScanForDelivery(legTarget, raceWinner, latestRef);
}

/**
 * Await the in-flight scan after the budget race already returned null/incomplete.
 * Identity is checked by the caller via stillActive / applies-to-request gates.
 */
export async function awaitLateBoardScanAfterBudget<T extends BudgetHandoffScan>(
  scanPromise: Promise<T | null>,
  opts: { legTarget: number; stillActive: () => boolean },
): Promise<T | null> {
  try {
    const late = await scanPromise;
    if (!opts.stillActive()) return null;
    if (!late || !boardScanIsComplete(late)) return null;
    if (!boardScanReadyForDelivery(late, opts.legTarget)) return null;
    return late;
  } catch {
    return null;
  }
}

/** Apply a partial or final scan onto the Coach ticket UI snapshot. */
export function applyBoardScanToUiSnapshot(
  prev: BoardScanUiSnapshot,
  scan: BudgetHandoffScan | null | undefined,
): BoardScanUiSnapshot {
  if (!scan) return prev;
  const complete = boardScanIsComplete(scan);
  const pickCount = scan.picks?.length ?? 0;
  return {
    requestedLegs: prev.requestedLegs,
    pickCount: pickCount > 0 ? pickCount : complete ? 0 : prev.pickCount,
    boardScanComplete: complete ? true : false,
    buildIdle: complete ? true : prev.buildIdle,
  };
}

export function boardScanUiShowsContinues(snap: BoardScanUiSnapshot): boolean {
  return coachTicketShowsScanInProgress({
    picksShortOfTarget: snap.pickCount < snap.requestedLegs,
    buildIdle: snap.buildIdle,
    boardScanComplete: snap.boardScanComplete,
  });
}

/**
 * Full handoff timeline for budget-boundary races:
 * partials flash → race times out → late scanComplete must replace the ticket.
 */
export function runBoardScanBudgetHandoffTimeline<T extends BudgetHandoffScan>(opts: {
  requestedLegs: number;
  partials: T[];
  raceWinner: T | null;
  latestAtRaceEnd: T | null;
  lateFinal: T | null;
}): {
  afterRace: T | null;
  uiAfterPartials: BoardScanUiSnapshot;
  uiAfterRace: BoardScanUiSnapshot;
  uiAfterLateFinal: BoardScanUiSnapshot;
  showsContinuesAfterRace: boolean;
  showsContinuesAfterLateFinal: boolean;
} {
  let ui: BoardScanUiSnapshot = {
    requestedLegs: opts.requestedLegs,
    pickCount: 0,
    boardScanComplete: null,
    buildIdle: false,
  };
  for (const partial of opts.partials) {
    ui = applyBoardScanToUiSnapshot(ui, partial);
  }
  const uiAfterPartials = { ...ui };

  const afterRace = resolveScanAfterBudgetRace(
    opts.raceWinner,
    opts.latestAtRaceEnd,
    opts.requestedLegs,
  );
  // Budget miss with only an incomplete partial on screen: build goes idle while
  // boardScanComplete stays false → "scan continues" residue.
  if (!afterRace || !boardScanIsComplete(afterRace)) {
    ui = { ...ui, buildIdle: true };
  } else {
    ui = applyBoardScanToUiSnapshot(ui, afterRace);
  }
  const uiAfterRace = { ...ui };
  const showsContinuesAfterRace = boardScanUiShowsContinues(uiAfterRace);

  if (opts.lateFinal) {
    ui = applyBoardScanToUiSnapshot(ui, opts.lateFinal);
  }
  const uiAfterLateFinal = { ...ui };

  return {
    afterRace,
    uiAfterPartials,
    uiAfterRace,
    uiAfterLateFinal,
    showsContinuesAfterRace,
    showsContinuesAfterLateFinal: boardScanUiShowsContinues(uiAfterLateFinal),
  };
}

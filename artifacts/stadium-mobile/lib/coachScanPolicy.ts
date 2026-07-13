// Coach full-board parlay scan policy — enforced in boardMarketScanner, ticket
// staging, and delivery gates. Never pad tickets with ungraded posted lines.

export const COACH_FULL_BOARD_SCAN_POLICY =
  "Scan every available market and every player prop — not just the top few. Score each market the same way (EV, edge, confidence, AI grade, and 10,000 simulations). Keep separate ranked pools for player props, game lines, team totals, and alternate lines. Build a balanced ticket (~50% player props, ~20–30% game lines, ~10–20% team totals, ~10–20% alternate lines). Only add more game lines when there truly are not enough qualified player props. Never lower AI standards to hit the leg count — every pick must have positive EV, positive edge, pass simulation, and meet the confidence threshold. Return fewer legs instead of weak filler.";

/** User-facing fixed-leg ticket policy (3, 5, 6, 10, 15, …). */
export const COACH_FIXED_LEG_TICKET_POLICY =
  "Scan every posted market and every player prop first. Score all markets the same way, then fill from separate ranked pools (~50% player props, ~20–30% game lines, ~10–20% team totals, ~10–20% alternate lines). Promote only AI-approved picks with positive EV, positive edge, passing simulation, and confidence above the minimum threshold. If there are not enough qualified picks, return fewer legs — never add ungraded or negative-EV filler to reach the requested count.";

export const COACH_NO_FILLER_SHORTFALL =
  "Every posted market was scanned — these are every AI Recommended and qualifying alt pick on the board. No filler was added to reach your requested leg count.";

export const COACH_FIXED_LEG_SHORTFALL_LEAD =
  "Every qualifying market was evaluated across the live board — only this many AI-backed picks met the quality bar.";

/** Exhaustive alt-ladder policy — every posted rung scored; mains then alts per market. */
export const COACH_EXHAUSTIVE_MARKET_LADDER_POLICY =
  "For every game, evaluate every posted alternate spread, alternate total, alternate team total, alternate player prop, combo prop, and ladder prop. Score every line independently in the background before the app opens and while the app is open. If the primary line fails, automatically continue evaluating alternate versions until a qualifying line is found or every posted line in that ladder has been exhausted.";

/** Visible one-liner when a fixed-leg ask returns fewer than requested. */
export function buildFixedLegCountShortfallLead(requested: number, actual: number): string {
  if (actual >= requested) return "";
  return `You asked for **${requested}** legs — only **${actual}** cleared the AI quality bar after every posted market was scanned. No ungraded filler was added.`;
}

/** Guarantee the shortfall lead is present when a fixed-leg ticket is short. */
export function ensureFixedLegShortfallLegNote(
  legNote: string,
  requested: number,
  actual: number,
): string {
  const lead = buildFixedLegCountShortfallLead(requested, actual);
  if (!lead) return legNote.trim();
  if (legNote.includes(lead) || /asked for (\*\*)?\d+(\*\*)? legs/i.test(legNote)) {
    return legNote.trim();
  }
  return legNote.trim() ? `${lead}\n\n${legNote.trim()}` : lead;
}

/** Fixed leg-count parlay (3, 5, 6, 10, 15, …) — full-board scan + staged alt promotion. */
export function isFixedLegCountParlay(requestedLegs: number): boolean {
  return requestedLegs >= 3;
}

/** Promote qualifying mains then alts to reach N — never round-out filler. */
export function shouldPromoteQualifyingAltsForFixedLegTicket(opts: {
  requestedLegs: number;
  isParlayBuild?: boolean;
  isAnalyze?: boolean;
  propsOnly?: boolean;
  explicitSingleGame?: boolean;
  oddsThreshold?: unknown;
  confidenceThreshold?: unknown;
  altSign?: unknown;
}): boolean {
  if (opts.isAnalyze || !opts.isParlayBuild) return false;
  if (!isFixedLegCountParlay(opts.requestedLegs)) return false;
  if (opts.propsOnly || opts.explicitSingleGame) return false;
  if (opts.oddsThreshold || opts.confidenceThreshold || opts.altSign) return false;
  return true;
}

/** Honest edge copy on posted-line backfill legs — never show on board-scan tickets. */
export const FILLER_BACKFILL_EDGE_NOTE =
  "Added to round out your requested ticket size — this is a real posted line from tonight's board, not a separate model edge.";

export function isFillerBackfillPick(pick: { edge?: string | null }): boolean {
  return pick.edge === FILLER_BACKFILL_EDGE_NOTE;
}

export function stripFillerBackfillPicks<
  T extends { edge?: string | null; isProp?: boolean },
>(picks: T[]): T[] {
  const hasBoardProps = picks.some((p) => p.isProp && !isFillerBackfillPick(p));
  return picks.filter((p) => {
    if (!isFillerBackfillPick(p)) return true;
    if (p.isProp && !hasBoardProps) return true;
    return false;
  });
}

/** Block assembleDeepParlay / finalizeDeepParlay / ungraded replenish on fixed-leg asks. */
export function shouldBlockUngradedParlayTopUp(opts: {
  promoteQualifyingAlts?: boolean;
  fullBoardScanned?: boolean;
  reachBoardEligible?: boolean;
}): boolean {
  if (opts.promoteQualifyingAlts) return true;
  if (opts.fullBoardScanned) return true;
  if (opts.reachBoardEligible) return true;
  return false;
}

/** True when a board-scan result filled the requested fixed leg count. */
export function boardScanMeetsLegTarget(
  scan: { picks?: { length: number } } | null | undefined,
  requestedLegs: number,
): boolean {
  return (scan?.picks?.length ?? 0) >= requestedLegs;
}

/** True when scan was staged for the exact leg count being delivered. */
export function boardScanMatchesLegTarget(
  scan:
    | {
        requestedLegs?: number;
        picks?: { length: number };
        scanComplete?: boolean;
      }
    | null
    | undefined,
  legTarget: number,
): boolean {
  if (!scan || legTarget <= 0) return true;
  if (scan.requestedLegs != null) return scan.requestedLegs === legTarget;
  // Legacy scans without metadata: only accept a complete ticket with exact leg count.
  // Never treat a partial larger scan (e.g. 4 picks from a 15-leg build) as a 4-leg ticket.
  if (!boardScanIsComplete(scan)) return false;
  return (scan.picks?.length ?? 0) === legTarget;
}

/**
 * True when a complete scan may finalize for this leg count.
 * A 15-leg scan must NOT satisfy an 8-leg ask (fixes prefix/slice reuse).
 */
export function boardScanReadyForDelivery(
  scan:
    | {
        picks?: { length: number };
        requestedLegs?: number;
        scanComplete?: boolean;
      }
    | null
    | undefined,
  legTarget: number,
): boolean {
  if (!scan?.picks?.length || !boardScanIsComplete(scan)) return false;
  if (legTarget <= 0) return true;
  if (scan.requestedLegs != null) return scan.requestedLegs === legTarget;
  return scan.picks.length === legTarget;
}

/** True when a board-scan finished evaluating the live board (not a partial preview). */
export function boardScanIsComplete(
  scan: { scanComplete?: boolean } | null | undefined,
): boolean {
  return scan?.scanComplete === true;
}

/** Prefer a finished scan (even with zero staged legs) over a partial with picks. */
export function preferBoardScanForDelivery<
  T extends { scanComplete?: boolean; picks?: { length: number } },
>(...candidates: (T | null | undefined)[]): T | null {
  for (const scan of candidates) {
    if (scan && boardScanIsComplete(scan)) return scan;
  }
  for (const scan of candidates) {
    if (scan?.picks?.length) return scan;
  }
  for (const scan of candidates) {
    if (scan) return scan;
  }
  return null;
}

/** Final ticket delivery — complete live scans only; never promote preview-cache rows. */
export function preferFinalBoardScanForDelivery<
  T extends { scanComplete?: boolean; picks?: { length: number }; requestedLegs?: number },
>(legTarget: number, ...candidates: (T | null | undefined)[]): T | null;
export function preferFinalBoardScanForDelivery<
  T extends { scanComplete?: boolean; picks?: { length: number }; requestedLegs?: number },
>(...candidates: (T | null | undefined)[]): T | null;
export function preferFinalBoardScanForDelivery<
  T extends { scanComplete?: boolean; picks?: { length: number }; requestedLegs?: number },
>(...args: (T | null | undefined | number)[]): T | null {
  let legTarget = 0;
  let candidates: (T | null | undefined)[];
  if (typeof args[0] === "number") {
    legTarget = args[0];
    candidates = args.slice(1) as (T | null | undefined)[];
  } else {
    candidates = args as (T | null | undefined)[];
  }
  for (const scan of candidates) {
    if (!scan || !boardScanIsComplete(scan)) continue;
    if (legTarget > 0 && !boardScanMatchesLegTarget(scan, legTarget)) continue;
    return scan;
  }
  return null;
}

/** Never pad 3+ leg parlays with ungraded posted lines when a board scan applies. */
export function shouldAllowReachCountBackfill(opts: {
  fullBoardScanned?: boolean;
  reachBoardEligible?: boolean;
  legTarget?: number;
  isParlayBuild?: boolean;
}): boolean {
  if (opts.fullBoardScanned) return false;
  if (opts.reachBoardEligible) return false;
  if (opts.isParlayBuild && (opts.legTarget ?? 0) >= 3) return false;
  return true;
}

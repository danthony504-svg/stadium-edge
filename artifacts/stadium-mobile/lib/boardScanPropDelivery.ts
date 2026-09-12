/**
 * Pure helpers for Coach board-scan prop delivery.
 * Kept free of api.ts so node:test can cover the 7-leg → 3 F5 latch without
 * loading the full scanner module graph.
 */

/** ~50% of an N-leg ticket is reserved for player props (matches preview staging). */
export function boardScanPropSlotCount(targetLegs: number): number {
  if (targetLegs < 3) return 0;
  return Math.max(1, Math.round(targetLegs * 0.5));
}

/** Game-line preview capacity while prop slots are still reserved. */
export function boardScanNonPropPreviewCap(targetLegs: number): number {
  return Math.max(0, targetLegs - boardScanPropSlotCount(targetLegs));
}

/**
 * Preview-only gate: while game lines are scoring and no props have landed yet,
 * hold reserved prop slots open so we do not paint F5-only previews as the ticket.
 *
 * Never set this on a final result — that wiped cleared game lines to a 0-leg
 * "instant empty" ticket when prop scoring threw or timed out (#469 regression).
 * Final prop shortfalls use `propPhaseIncomplete` + honest notes instead.
 */
export function shouldKeepAwaitingPropSlots(opts: {
  preview?: boolean;
  propsOnly?: boolean;
  targetLegs: number;
  propCount: number;
  propPhaseIncomplete?: boolean;
}): boolean {
  if (opts.propsOnly || opts.targetLegs < 3) return false;
  if (!opts.preview) return false;
  const propSlots = boardScanPropSlotCount(opts.targetLegs);
  return opts.propCount < propSlots && opts.propCount === 0;
}

function countPropLikePicks(picks: { isProp?: boolean; market?: string }[]): number {
  return picks.filter((p) => p.isProp || /alt/i.test(p.market || "")).length;
}

/**
 * Final ticket picks after a board scan. Never wipe cleared legs when props are
 * incomplete — that was the post-#469 instant 0-of-7 failure (phone screenshot).
 *
 * Old buggy formula (must stay dead):
 *   propPoolSize > 0 && propLike === 0 && awaitingPropSlots → []
 */
export function selectFinalCoachParlayPicks<T extends { isProp?: boolean; market?: string }>(
  rawPicks: T[],
): T[] {
  return rawPicks;
}

/** Honest delivery note for fixed-leg shortfalls / incomplete prop scoring. */
export function buildFinalCoachParlayNote(opts: {
  target: number;
  picks: { isProp?: boolean; market?: string }[];
  propPoolSize: number;
  propsPending: boolean;
  shortfallLead: string;
  timedOut?: boolean;
  budgetMs?: number;
  scanMissing?: boolean;
  scanNote?: string;
}): string {
  const propLike = countPropLikePicks(opts.picks);
  const thinGameOnlyNote =
    opts.picks.length > 0 &&
    opts.picks.length < opts.target &&
    propLike === 0 &&
    opts.propPoolSize > 0 &&
    !opts.propsPending
      ? ` Scanned ${opts.propPoolSize} posted props/alts — none cleared the AI quality bar with these game lines.`
      : "";
  const propsIncompleteNote =
    opts.propPoolSize > 0 && propLike === 0 && opts.propsPending
      ? opts.picks.length > 0
        ? ` Player props did not finish scoring — showing ${opts.picks.length} game-line pick${opts.picks.length === 1 ? "" : "s"} that cleared. Try again for a full props mix.`
        : ` Loaded ${opts.propPoolSize} posted props/alts but prop scoring did not finish and no game lines cleared — try again.`
      : "";
  const emptyBoardNote =
    opts.picks.length === 0 && opts.scanMissing && !opts.timedOut
      ? ` Board scan did not return picks — try again.`
      : "";
  return (
    (opts.scanNote?.trim() && opts.picks.length > 0 && propLike > 0 ? opts.scanNote.trim() : "") ||
    (opts.shortfallLead
      ? `${opts.shortfallLead}${thinGameOnlyNote}${propsIncompleteNote}`
      : "") ||
    propsIncompleteNote ||
    emptyBoardNote ||
    (opts.timedOut
      ? `Stopped at the ${Math.round((opts.budgetMs ?? 0) / 1000)}s delivery budget — showing every AI-backed pick that cleared so far.`
      : opts.picks.length
        ? ""
        : `No AI-backed picks cleared the quality bar for a ${opts.target}-leg ticket.`)
  );
}

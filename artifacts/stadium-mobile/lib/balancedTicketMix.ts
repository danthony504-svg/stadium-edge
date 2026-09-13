// Balanced parlay composition — separate category pools, props-first backfill.

export type BoardMarketCategory = "props" | "gameLines" | "teamTotals" | "alternateLines";

export const BOARD_MARKET_CATEGORIES: BoardMarketCategory[] = [
  "props",
  "gameLines",
  "teamTotals",
  "alternateLines",
];

/** Target mix for multi-leg Coach tickets (must sum to 1). Midpoints of spec ranges. */
export const BALANCED_MIX_FRACTIONS = {
  props: 0.5,
  gameLines: 0.25,
  teamTotals: 0.125,
  alternateLines: 0.125,
} as const;

export type BalancedMixSlots = Record<BoardMarketCategory, number>;

/** Slot budget per category for a fixed-leg ask — never exceeds target. */
export function balancedMixSlots(target: number): BalancedMixSlots {
  if (target <= 0) {
    return { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 };
  }
  if (target === 1) {
    return { props: 1, gameLines: 0, teamTotals: 0, alternateLines: 0 };
  }
  if (target === 2) {
    return { props: 1, gameLines: 1, teamTotals: 0, alternateLines: 0 };
  }

  let props = Math.max(1, Math.round(target * BALANCED_MIX_FRACTIONS.props));
  let gameLines = Math.max(0, Math.round(target * BALANCED_MIX_FRACTIONS.gameLines));
  let teamTotals = Math.max(0, Math.round(target * BALANCED_MIX_FRACTIONS.teamTotals));
  // Round the alt share (don't leave it as pure remainder) so 6–7 leg tickets
  // still reserve alt-spread/total slots instead of collapsing to 0.
  let alternateLines = Math.max(0, Math.round(target * BALANCED_MIX_FRACTIONS.alternateLines));
  // 6+ legs: at least one alt slot when books post competitive Alt Spreads.
  if (target >= 6 && alternateLines < 1) alternateLines = 1;

  let sum = props + gameLines + teamTotals + alternateLines;
  while (sum > target) {
    // Trim main game lines before alt slots so mix keeps alt-spread diversity.
    if (gameLines > 1) {
      gameLines -= 1;
    } else if (teamTotals > 0) {
      teamTotals -= 1;
    } else if (props > 1) {
      props -= 1;
    } else if (alternateLines > 0) {
      alternateLines -= 1;
    } else if (gameLines > 0) {
      gameLines -= 1;
    } else {
      break;
    }
    sum = props + gameLines + teamTotals + alternateLines;
  }

  while (sum < target && props < target) {
    props += 1;
    sum += 1;
  }

  return { props, gameLines, teamTotals, alternateLines };
}

/** Backfill order when a category bucket is short — props before game lines. */
export const BALANCED_BACKFILL_ORDER: BoardMarketCategory[] = [
  "props",
  "alternateLines",
  "teamTotals",
  "gameLines",
];

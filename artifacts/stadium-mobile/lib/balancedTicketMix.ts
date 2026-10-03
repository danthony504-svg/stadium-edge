// Balanced parlay composition — separate category pools, props-first backfill.

export type BoardMarketCategory = "props" | "gameLines" | "teamTotals" | "alternateLines";

export const BOARD_MARKET_CATEGORIES: BoardMarketCategory[] = [
  "props",
  "gameLines",
  "teamTotals",
  "alternateLines",
];

/** Target mix for multi-leg Coach tickets (must sum to 1). Midpoints of spec ranges. */
/** Fewer forced team-total O/U slots; more room for alt spreads/run lines. */
export const BALANCED_MIX_FRACTIONS = {
  props: 0.5,
  gameLines: 0.25,
  teamTotals: 0.05,
  alternateLines: 0.2,
} as const;

/** NFL/NCAAF mix asks: fewer prop seats, more FG/alt sides so tickets are not Over-prop walls. */
export const FOOTBALL_BALANCED_MIX_FRACTIONS = {
  props: 0.4,
  gameLines: 0.3,
  teamTotals: 0.05,
  alternateLines: 0.25,
} as const;

/**
 * College team-market boards: no player-prop seats — reserve FG + team totals
 * + period/alt seats so spreads cannot dominate a 5/7/10/15-leg ask. Still
 * uses only posted Odds API markets (team_totals*, period spreads/totals) —
 * never FanDuel Team Yards or invented player props.
 */
export const COLLEGE_FOOTBALL_BALANCED_MIX_FRACTIONS = {
  props: 0,
  gameLines: 0.35,
  teamTotals: 0.3,
  alternateLines: 0.35,
} as const;

export type BalancedMixSlots = Record<BoardMarketCategory, number>;

/** Slot budget per category for a fixed-leg ask — never exceeds target. */
export function balancedMixSlots(
  target: number,
  fractions: typeof BALANCED_MIX_FRACTIONS = BALANCED_MIX_FRACTIONS,
  opts?: { floorTeamTotals?: boolean },
): BalancedMixSlots {
  if (target <= 0) {
    return { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 };
  }
  if (target === 1) {
    if (fractions.props <= 0) {
      return { props: 0, gameLines: 1, teamTotals: 0, alternateLines: 0 };
    }
    return { props: 1, gameLines: 0, teamTotals: 0, alternateLines: 0 };
  }
  if (target === 2) {
    if (fractions.props <= 0) {
      return { props: 0, gameLines: 1, teamTotals: 0, alternateLines: 1 };
    }
    return { props: 1, gameLines: 1, teamTotals: 0, alternateLines: 0 };
  }

  // Only force a prop seat when the mix actually budgets props (college = 0).
  let props =
    fractions.props > 0
      ? Math.max(1, Math.round(target * fractions.props))
      : Math.max(0, Math.round(target * fractions.props));
  let gameLines = Math.max(0, Math.round(target * fractions.gameLines));
  let teamTotals = Math.max(0, Math.round(target * fractions.teamTotals));
  // College boards: keep at least one team-total seat when the ask is deep enough.
  if (opts?.floorTeamTotals && target >= 5 && teamTotals < 1) teamTotals = 1;
  // Round alt share (don't leave as pure remainder) so 6–7 legs still get
  // alt spread/run-line slots instead of collapsing to 0.
  let alternateLines = Math.max(0, Math.round(target * fractions.alternateLines));
  if (target >= 6 && alternateLines < 1) alternateLines = 1;

  let sum = props + gameLines + teamTotals + alternateLines;
  while (sum > target) {
    // On college floors, trim props/GL before wiping the last team-total seat.
    if (opts?.floorTeamTotals && teamTotals <= 1) {
      if (props > 0) props -= 1;
      else if (gameLines > 1) gameLines -= 1;
      else if (alternateLines > 0) alternateLines -= 1;
      else if (teamTotals > 0) teamTotals -= 1;
      else break;
    } else if (teamTotals > 0 && !opts?.floorTeamTotals) {
      teamTotals -= 1;
    } else if (gameLines > 1) {
      gameLines -= 1;
    } else if (props > 1) {
      props -= 1;
    } else if (alternateLines > 0) {
      alternateLines -= 1;
    } else if (teamTotals > 0) {
      teamTotals -= 1;
    } else if (gameLines > 0) {
      gameLines -= 1;
    } else if (props > 0) {
      props -= 1;
    } else {
      break;
    }
    sum = props + gameLines + teamTotals + alternateLines;
  }

  while (sum < target) {
    // College team-market boards: pad alts / GL / team totals — never invent
    // ghost player-prop seats when props fraction is 0.
    if (opts?.floorTeamTotals && fractions.props <= 0) {
      if (alternateLines < target) {
        alternateLines += 1;
        sum += 1;
        continue;
      }
      if (gameLines < target) {
        gameLines += 1;
        sum += 1;
        continue;
      }
      if (teamTotals < target) {
        teamTotals += 1;
        sum += 1;
        continue;
      }
      break;
    }
    if (props < target) {
      props += 1;
      sum += 1;
      continue;
    }
    break;
  }

  return { props, gameLines, teamTotals, alternateLines };
}

/** Backfill order when a category bucket is short — props before game lines; sides before team totals. */
export const BALANCED_BACKFILL_ORDER: BoardMarketCategory[] = [
  "props",
  "alternateLines",
  "gameLines",
  "teamTotals",
];

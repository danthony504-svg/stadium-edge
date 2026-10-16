/**
 * Discover Home quick-action destinations — all four open Coach.
 *
 * Hot Picks → balanced parlay
 * Easy Money → safe / lower-risk parlay
 * Best Value → value parlay (qualified positive-EV selection)
 * Longshots → lottery / longshot parlay (higher payout among qualified)
 *
 * Explicit `ticketStyle` drives selection (not message text alone).
 * Sport is preserved in the ask. Ticket styles still pass Final AI / sim /
 * NCAAF P0 / period / correlation / rare-event gates — modes never weaken
 * qualification or pad with unqualified filler.
 */

import type { CoachTicketStyle } from "./coachTicketQualityTiers.ts";

/** Lightweight labels — avoid importing sports.ts (vector-icons) into unit tests. */
const SPORT_LABELS: Record<string, string> = {
  mlb: "MLB",
  nfl: "NFL",
  ncaaf: "CFB",
  ncaab: "CBB",
  wnba: "WNBA",
  nba: "NBA",
  nhl: "NHL",
  soccer: "Soccer",
  tennis: "Tennis",
  ufc: "UFC",
};

function shortcutSportLabel(sportId: string): string {
  return SPORT_LABELS[sportId] ?? sportId.toUpperCase();
}

export type HomeShortcutId = "hot_picks" | "easy_money" | "best_value" | "longshots";

export type HomeShortcutDest = {
  id: HomeShortcutId;
  kind: "coach";
  autoMsg: string;
  /** Explicit Coach mode — must affect selection, not only the ask text. */
  ticketStyle: CoachTicketStyle;
  /** Silent home launch — hide user bubble. */
  silent: boolean;
};

/** Map Home shortcut → explicit Coach ticket style. */
export function homeShortcutTicketStyle(id: HomeShortcutId): CoachTicketStyle {
  switch (id) {
    case "hot_picks":
      return "balanced";
    case "easy_money":
      return "safe";
    case "best_value":
      return "value";
    case "longshots":
      return "longshot";
  }
}

/** Distinct Coach asks — sport preserved; wording aligns with ticketStyle. */
export function homeShortcutCoachAsk(id: HomeShortcutId, sportId: string): string {
  const label = shortcutSportLabel(sportId);
  switch (id) {
    case "easy_money":
      return `Build me a safe lower-risk ${label} parlay for tonight`;
    case "best_value":
      return `Build me a best-value ${label} parlay from qualified positive-EV picks for tonight`;
    case "longshots":
      return `Build me a lottery longshot ${label} parlay targeting a higher payout for tonight`;
    case "hot_picks":
    default:
      return `Build me the best balanced ${label} parlay for tonight`;
  }
}

export function resolveHomeShortcut(id: HomeShortcutId, sportId: string): HomeShortcutDest {
  return {
    id,
    kind: "coach",
    autoMsg: homeShortcutCoachAsk(id, sportId),
    ticketStyle: homeShortcutTicketStyle(id),
    // Hot Picks stays silent; others show the ask bubble.
    silent: id === "hot_picks",
  };
}

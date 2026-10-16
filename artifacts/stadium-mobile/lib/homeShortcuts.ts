/**
 * Discover Home quick-action destinations — all four open Coach.
 *
 * Hot Picks → balanced parlay
 * Easy Money → safe / lower-risk parlay
 * Best Value → value parlay (qualified positive-EV selection)
 * Longshots → lottery / longshot parlay (higher payout among qualified)
 *
 * Explicit `ticketStyle` drives selection (not message text alone).
 * Home sport is NOT inherited — asks are all-sports by default so Coach
 * loads the full supported board. Typed sport requests in Coach still
 * scope via focalSportsFromText. Modes never weaken qualification or pad
 * with unqualified filler; mixed-sport tickets are allowed without forcing
 * every league onto the ticket.
 */

import type { CoachTicketStyle } from "./coachTicketQualityTiers.ts";

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

/**
 * Distinct Coach asks — no Home sport token (all-sports board by default).
 * Wording still aligns with ticketStyle for free-typed detect fallback.
 */
export function homeShortcutCoachAsk(id: HomeShortcutId): string {
  switch (id) {
    case "easy_money":
      return "Build me a safe lower-risk parlay for tonight across tonight's board";
    case "best_value":
      return "Build me a best-value parlay from qualified positive-EV picks for tonight across tonight's board";
    case "longshots":
      return "Build me a lottery longshot parlay targeting a higher payout for tonight across tonight's board";
    case "hot_picks":
    default:
      return "Build me the best balanced parlay for tonight across tonight's board";
  }
}

export function resolveHomeShortcut(id: HomeShortcutId): HomeShortcutDest {
  return {
    id,
    kind: "coach",
    autoMsg: homeShortcutCoachAsk(id),
    ticketStyle: homeShortcutTicketStyle(id),
    // Hot Picks stays silent; others show the ask bubble.
    silent: id === "hot_picks",
  };
}

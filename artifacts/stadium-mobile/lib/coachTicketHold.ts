/**
 * Coach ticket publish policy — hold pick cards until the build finishes.
 *
 * Mid-scan partials used to paint under "Building your N-leg ticket…", which
 * looked like a trickle (2 MLs → more legs). Status text may still update;
 * cards commit once at terminal (success, shortfall, or absolute budget).
 *
 * Absolute-budget hang guard: always publish whatever cleared when the session
 * ends — never latch an empty ticket if buffered picks exist.
 * Football mix: prefer props; when props miss, still deliver cleared game lines
 * (never wipe scored legs into an empty ticket).
 * Non-football: never re-truncate the buffer for empty prop seats (that was
 * phone 5→2 / 6→3 when a seat-capped preview became the terminal ticket).
 */

import {
  askRequiresFootballPropMix,
  finalizeFootballPropMixPicks,
  finalizeGeneralPropMixPicks,
} from "./boardScanPropDelivery.ts";

export type CoachTicketPublishPhase = "building" | "terminal";

/** True only when the Coach session is finished (or force-flushed). */
export function shouldPublishCoachTicketPicks(phase: CoachTicketPublishPhase): boolean {
  return phase === "terminal";
}

/**
 * Picks to show when the absolute delivery budget fires.
 * Prefer the latest buffered scan picks; fall back to anything already on the message.
 * Football prop-mix: hold reserved seats while props are still pending; after
 * props finish with 0 clears, deliver scored game lines (never wipe to empty).
 * Non-football: ship every buffered leg toward N (no seat re-cap).
 */
export function resolveCoachTerminalPicks<T extends { isProp?: boolean }>(opts: {
  bufferedPicks: readonly T[] | null | undefined;
  messagePicks: readonly T[] | null | undefined;
  /** User ask text — used to detect football prop-mix. */
  askText?: string | null;
  requestedLegs?: number;
  /** True when prop scoring was cut short / still pending at flush. */
  propPhaseIncomplete?: boolean;
}): T[] {
  let picks: T[] = [];
  if (opts.bufferedPicks && opts.bufferedPicks.length > 0) {
    picks = [...opts.bufferedPicks];
  } else if (opts.messagePicks && opts.messagePicks.length > 0) {
    picks = [...opts.messagePicks];
  }
  if (!picks.length) return picks;

  const target = opts.requestedLegs ?? picks.length;
  if (target < 3) return picks;

  const requirePropMix = askRequiresFootballPropMix(opts.askText);
  if (requirePropMix) {
    return finalizeFootballPropMixPicks(picks, target, {
      propPhaseIncomplete: opts.propPhaseIncomplete,
    });
  }
  return finalizeGeneralPropMixPicks(picks, target);
}

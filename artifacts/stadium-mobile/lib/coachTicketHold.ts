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
 */

import {
  askRequiresFootballPropMix,
  finalizeFootballPropMixPicks,
} from "./boardScanPropDelivery.ts";

export type CoachTicketPublishPhase = "building" | "terminal";

/** True only when the Coach session is finished (or force-flushed). */
export function shouldPublishCoachTicketPicks(phase: CoachTicketPublishPhase): boolean {
  return phase === "terminal";
}

/**
 * Picks to show when the absolute delivery budget fires.
 * Prefer the latest buffered scan picks; fall back to anything already on the message.
 * Football prop-mix keeps prop seats when props exist; otherwise delivers cleared
 * game lines rather than wiping to empty (phone SCORED_BUT_NOT_STAGED).
 */
export function resolveCoachTerminalPicks<T extends { isProp?: boolean }>(opts: {
  bufferedPicks: readonly T[] | null | undefined;
  messagePicks: readonly T[] | null | undefined;
  /** User ask text — used to detect football prop-mix. */
  askText?: string | null;
  requestedLegs?: number;
}): T[] {
  let picks: T[] = [];
  if (opts.bufferedPicks && opts.bufferedPicks.length > 0) {
    picks = [...opts.bufferedPicks];
  } else if (opts.messagePicks && opts.messagePicks.length > 0) {
    picks = [...opts.messagePicks];
  }
  if (!picks.length) return picks;

  const target = opts.requestedLegs ?? picks.length;
  const requirePropMix = askRequiresFootballPropMix(opts.askText);
  if (!requirePropMix || target < 3) return picks;

  return finalizeFootballPropMixPicks(picks, target);
}

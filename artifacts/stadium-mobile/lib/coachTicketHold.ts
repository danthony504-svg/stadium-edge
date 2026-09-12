/**
 * Coach ticket publish policy — hold pick cards until the build finishes.
 *
 * Mid-scan partials used to paint under "Building your N-leg ticket…", which
 * looked like a trickle (2 MLs → more legs). Status text may still update;
 * cards commit once at terminal (success, shortfall, or absolute budget).
 *
 * Absolute-budget hang guard: always publish whatever cleared when the session
 * ends — never latch an empty ticket if buffered picks exist.
 */

export type CoachTicketPublishPhase = "building" | "terminal";

/** True only when the Coach session is finished (or force-flushed). */
export function shouldPublishCoachTicketPicks(phase: CoachTicketPublishPhase): boolean {
  return phase === "terminal";
}

/**
 * Picks to show when the absolute delivery budget fires.
 * Prefer the latest buffered scan picks; fall back to anything already on the message.
 */
export function resolveCoachTerminalPicks<T>(opts: {
  bufferedPicks: readonly T[] | null | undefined;
  messagePicks: readonly T[] | null | undefined;
}): T[] {
  if (opts.bufferedPicks && opts.bufferedPicks.length > 0) {
    return [...opts.bufferedPicks];
  }
  if (opts.messagePicks && opts.messagePicks.length > 0) {
    return [...opts.messagePicks];
  }
  return [];
}

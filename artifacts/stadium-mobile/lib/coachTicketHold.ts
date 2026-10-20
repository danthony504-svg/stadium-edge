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
 *
 * Absolute flush revalidates every seat (including ALT): drop known-started /
 * far-future kickoffs, drop scored seats below 52/C+, drop grounding mismatches.
 * Unknown startsAt / unscored scanner-qualified seats are preserved — do not
 * treat enrichment gaps as started games.
 */

import {
  askRequiresFootballPropMix,
  finalizeFootballPropMixPicks,
  finalizeGeneralPropMixPicks,
} from "./boardScanPropDelivery.ts";
import { applyDeliveryGroundingGate } from "./coachDeliveryGrounding.ts";
import { meetsCoachSimQualityFloor } from "./gameSimQualityGates.ts";
import { isPregameBettableForSport } from "./slate.ts";
import {
  filterPicksByAskMarketConstraint,
  parseCoachAskMarketConstraint,
} from "./coachAskMarketFilter.ts";

export type CoachTicketPublishPhase = "building" | "terminal";

/** Minimal seat shape for absolute-flush revalidation (ParsedPick-compatible). */
export type CoachFlushPick = {
  isProp?: boolean;
  sport?: string;
  startsAt?: string | null;
  game?: string;
  market?: string;
  pick?: string;
  player?: string;
  teamAbbr?: string | null;
  athleteId?: string | null;
  propMarketKey?: string;
  grade?: string | null;
  confidencePct?: number | null;
  qualificationStatus?: "qualified" | "rejected";
  scores?: { grade?: string | null; confidencePct?: number | null } | null;
  finalAiScore?: { grade?: string | null; confidencePct?: number | null } | null;
  ticketRole?: "main" | "alt";
  propIsAlt?: boolean;
  [key: string]: unknown;
};

/** True only when the Coach session is finished (or force-flushed). */
export function shouldPublishCoachTicketPicks(phase: CoachTicketPublishPhase): boolean {
  return phase === "terminal";
}

/**
 * Budget-stop copy belongs on incomplete / provisional tickets only.
 * A fully validated N/N ticket must never claim the delivery budget stopped it.
 */
export function coachBudgetStopNoteShouldShow(opts: {
  timedOut?: boolean;
  pickCount: number;
  target: number;
}): boolean {
  return !!opts.timedOut && opts.pickCount < opts.target;
}

/**
 * Drop only legs with a known kickoff that is already started or past 48h.
 * Missing / unparseable startsAt stays — enrichment gaps are not "started".
 */
export function filterFlushKnownStartedPicks<T extends CoachFlushPick>(
  picks: readonly T[],
): T[] {
  return picks.filter((p) => {
    const startsAt = p.startsAt;
    if (startsAt == null || String(startsAt).trim() === "") return true;
    const t = Date.parse(String(startsAt));
    if (!Number.isFinite(t)) return true;
    return isPregameBettableForSport(startsAt, p.sport ?? "");
  });
}

function flushSeatGrade(p: CoachFlushPick): string | null | undefined {
  return (
    p.grade ??
    p.finalAiScore?.grade ??
    p.scores?.grade ??
    null
  );
}

function flushSeatConfidence(p: CoachFlushPick): number | null | undefined {
  return (
    p.confidencePct ??
    p.finalAiScore?.confidencePct ??
    p.scores?.confidencePct ??
    null
  );
}

function flushSeatIsScored(p: CoachFlushPick): boolean {
  const grade = flushSeatGrade(p);
  const conf = flushSeatConfidence(p);
  return (grade != null && String(grade).trim() !== "") || conf != null;
}

/**
 * Drop rejected / below-floor scored seats. Keep scanner-qualified unscored
 * seats and seats with no score metadata (provisional buffer identity).
 * ALT and main seats use the same 52/C+ floor when scored.
 */
export function filterQualifiedFlushSeats<T extends CoachFlushPick>(
  picks: readonly T[],
): T[] {
  return picks.filter((p) => {
    if (p.qualificationStatus === "rejected") return false;
    if (!flushSeatIsScored(p)) return true;
    return meetsCoachSimQualityFloor({
      grade: flushSeatGrade(p),
      confidencePct: flushSeatConfidence(p),
    });
  });
}

/**
 * Shared post-belts for absolute flush and finalization: known-started,
 * quality floor on scored seats, delivery grounding (incl. ALT).
 * Does not invent replacements from an empty candidate pool on flush.
 */
export function revalidateCoachTerminalDeliveryPicks<T extends CoachFlushPick>(
  picks: readonly T[],
  opts?: { target?: number; qualifiedCandidates?: readonly T[] | null },
): T[] {
  if (!picks.length) return [];
  let next = filterFlushKnownStartedPicks(picks);
  next = filterQualifiedFlushSeats(next);
  const target =
    typeof opts?.target === "number" && Number.isFinite(opts.target)
      ? Math.max(0, Math.floor(opts.target))
      : next.length;
  // Replacements must pass the same pregame and score gates as existing seats.
  // Otherwise a grounded-but-started or low-grade backup can re-enter here.
  const eligibleReplacements = filterQualifiedFlushSeats(
    filterFlushKnownStartedPicks(opts?.qualifiedCandidates ?? []),
  );
  const grounded = applyDeliveryGroundingGate({
    picks: next,
    qualifiedCandidates: eligibleReplacements,
    target,
  });
  return grounded.picks;
}

/**
 * Full qualified ticket for early / absolute success — target met after
 * seat-cap + revalidation. Provisional football reserved-seat buffers that
 * stay below N after finalize are not full.
 */
export function coachTerminalTicketIsComplete(opts: {
  picks: readonly unknown[];
  requestedLegs: number;
}): boolean {
  const target = opts.requestedLegs;
  if (target < 3) return opts.picks.length > 0;
  return opts.picks.length >= target;
}

/**
 * Picks to show when the absolute delivery budget fires.
 * Prefer the latest buffered scan picks; fall back to anything already on the message.
 * Football prop-mix: hold reserved seats while props are still pending; after
 * props finish with 0 clears, deliver scored game lines (never wipe to empty).
 * Non-football: ship every buffered leg toward N (no seat re-cap).
 * Always revalidate seats before return (started / quality / grounding).
 */
export function resolveCoachTerminalPicks<T extends CoachFlushPick>(opts: {
  bufferedPicks: readonly T[] | null | undefined;
  messagePicks: readonly T[] | null | undefined;
  /** User ask text — market constraints apply to stop, error, and budget flushes too. */
  askText?: string | null;
  requestedLegs?: number;
  /** True when prop scoring was cut short / still pending at flush. */
  propPhaseIncomplete?: boolean;
  /** Optional already-qualified leftovers for grounding refill. */
  qualifiedCandidates?: readonly T[] | null;
}): T[] {
  let picks: T[] = [];
  if (opts.bufferedPicks && opts.bufferedPicks.length > 0) {
    picks = [...opts.bufferedPicks];
  } else if (opts.messagePicks && opts.messagePicks.length > 0) {
    picks = [...opts.messagePicks];
  }
  if (!picks.length) return picks;

  const target = opts.requestedLegs ?? picks.length;
  const constraint = parseCoachAskMarketConstraint(opts.askText);
  picks = filterPicksByAskMarketConstraint(picks, constraint);
  const qualifiedCandidates = filterPicksByAskMarketConstraint(
    [...(opts.qualifiedCandidates ?? [])],
    constraint,
  );
  if (target < 3) {
    return filterPicksByAskMarketConstraint(
      revalidateCoachTerminalDeliveryPicks(picks, {
        target: picks.length,
        qualifiedCandidates,
      }),
      constraint,
    );
  }

  const requirePropMix = askRequiresFootballPropMix(opts.askText);
  if (requirePropMix) {
    picks = finalizeFootballPropMixPicks(picks, target, {
      propPhaseIncomplete: opts.propPhaseIncomplete,
    });
  } else {
    picks = finalizeGeneralPropMixPicks(picks, target);
  }

  return filterPicksByAskMarketConstraint(
    revalidateCoachTerminalDeliveryPicks(picks, { target, qualifiedCandidates }),
    constraint,
  );
}

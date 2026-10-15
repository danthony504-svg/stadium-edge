/**
 * Shared delivery qualification — used after any mutation that can replace a
 * leg or change its market / pick / odds (same-team dedupe, exact dedupe,
 * mlLean swap, optimizer swap, side-consistency survivors).
 *
 * Live path rule: game-line legs MUST carry Final AI simHit. Missing sim
 * fields reject the candidate — no client/server sim-map-only fallback at
 * delivery. That closes the coverHitRates vs coverProbs discrepancy for
 * tickets that reach the phone.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { p0UnvalidatedSimDecision } from "./coachP0UnvalidatedTotals.ts";
import { isGameLinePick } from "./gameSimScoring.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import { dedupePicksByMarketLadder, wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import {
  filterPicksByAskMarketConstraint,
  type CoachAskMarketConstraint,
} from "./coachAskMarketFilter.ts";
import { maxLegsPerGame, wouldExceedMaxLegsPerGame } from "./parlayCorrelationScore.ts";

export function legIdentityKey(pick: ParsedPick): string {
  return `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}`.toLowerCase();
}

export function legChanged(
  before: ParsedPick,
  after: ParsedPick,
): boolean {
  return legIdentityKey(before) !== legIdentityKey(after);
}

/**
 * Shared qualification floor for a delivered (or about-to-deliver) leg.
 * Mirrors lean substitute + staging role gates; fail-closed on missing Final
 * AI simulation fields for game lines.
 */
export function deliveryCandidateStillQualified(pick: ParsedPick): boolean {
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  if (!pick.game || !pick.market || !pick.pick) return false;
  if (p0UnvalidatedSimDecision(pick)) return false;

  const isGameSide = isGameLinePick(pick) && !pick.isProp;
  if (isGameSide) {
    if (!pick.finalAiScore) return false;
    // No sim-map-only delivery — Final AI simHit required on the live path.
    if (pick.finalAiScore.simHit == null || !Number.isFinite(pick.finalAiScore.simHit)) {
      return false;
    }
    if (!pickHasSimGrade(pick, pick.finalAiScore.simHit)) return false;
    if (boardLegPoolRole(pick, pick.finalAiScore) == null) return false;
    return true;
  }

  // Props / totals that already carry a score must still clear sim grade.
  if (pick.finalAiScore?.simHit != null) {
    if (!pickHasSimGrade(pick, pick.finalAiScore.simHit)) return false;
  }
  return true;
}

/**
 * After a replacement that changes market/pick/odds: accept `next` only when
 * it still clears shared qualification. Otherwise keep `prev` if still
 * qualified; else drop (null).
 */
export function acceptReplacementIfStillQualified(
  prev: ParsedPick,
  next: ParsedPick,
): ParsedPick | null {
  if (!legChanged(prev, next)) {
    return deliveryCandidateStillQualified(next) ? next : null;
  }
  if (deliveryCandidateStillQualified(next)) return next;
  if (deliveryCandidateStillQualified(prev)) return prev;
  return null;
}

/** Filter a ticket to legs that still pass shared qualification. */
export function revalidateDeliveryPicks(picks: ParsedPick[]): {
  picks: ParsedPick[];
  dropped: number;
  droppedKeys: string[];
} {
  const out: ParsedPick[] = [];
  const droppedKeys: string[] = [];
  for (const p of picks) {
    if (deliveryCandidateStillQualified(p)) out.push(p);
    else droppedKeys.push(legIdentityKey(p));
  }
  return { picks: out, dropped: droppedKeys.length, droppedKeys };
}

/**
 * Selection-time correlation belt: one rung per market ladder + hard
 * per-game cap. Distinct alts are preserved in score pools via
 * marketLadderScoreKey; this collapses equivalent outcomes at seating.
 */
/**
 * Exception and final-delivery belt. Drops anything that missed the ask's
 * market restriction, Final AI qualification, ladder dedupe, or per-game cap.
 */
export function recoverQualifiedDeliveryPicks(
  picks: readonly ParsedPick[],
  constraint: CoachAskMarketConstraint,
  opts: { requestedLegs?: number; legsPerGameCap?: number | null } = {},
): ParsedPick[] {
  const restricted = filterPicksByAskMarketConstraint([...picks], constraint);
  const qualified = revalidateDeliveryPicks(restricted).picks;
  const deduped = dedupePicksByMarketLadder(qualified);
  return enforceTicketCorrelationAtSelection(deduped, opts);
}

export function enforceTicketCorrelationAtSelection(
  picks: ParsedPick[],
  opts: { requestedLegs?: number; legsPerGameCap?: number | null } = {},
): ParsedPick[] {
  const out: ParsedPick[] = [];
  const target = opts.requestedLegs ?? 7;
  const maxPerGame = maxLegsPerGame(target, opts.legsPerGameCap);
  for (const pick of picks) {
    if (!deliveryCandidateStillQualified(pick)) continue;
    if (wouldRepeatMarketLadder(pick, out)) continue;
    if (
      isGameLinePick(pick) &&
      !pick.isProp &&
      wouldExceedMaxLegsPerGame(pick, out, maxPerGame)
    ) {
      continue;
    }
    out.push(pick);
  }
  return out;
}

export type DeliveryMutation = {
  stage: "same_team_dedupe" | "exact_dedupe" | "side_consistency" | "revalidate";
  action: "keep" | "replace" | "drop";
  from?: string;
  to?: string;
  reason: string;
};
